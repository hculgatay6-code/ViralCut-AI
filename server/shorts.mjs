import { ExportError, inputOptions, probe, run } from './media.mjs'

export const frameSizes = { vertical: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080] }

export function validateProfile(profile) {
  if (profile === undefined) return undefined
  if (!profile || ![720, 1080].includes(profile.resolution) || ![24, 25, 30, 50, 60].includes(profile.fps) ||
      !['quality', 'balanced', 'small'].includes(profile.quality) ||
      !Number.isInteger(profile.bitrate) || (profile.bitrate !== 0 && !numberIn(profile.bitrate, 500, 50000))) {
    throw new ExportError('badEdit', 400)
  }
  return { resolution: profile.resolution, fps: profile.fps, quality: profile.quality, bitrate: profile.bitrate }
}

function numberIn(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max
}

export function validateAnalysis(settings) {
  const { threshold, minimum } = settings
  if (!numberIn(threshold, -65, -12) || !numberIn(minimum, 0.2, 10)) throw new ExportError('badEdit', 400)
  return { threshold, minimum }
}

export function validateEdit(edit) {
  if (!edit || typeof edit !== 'object') throw new ExportError('badEdit', 400)
  const { frame, remove = [], encoder = 'auto' } = edit
  if (!['auto', 'cpu'].includes(encoder) || !Array.isArray(remove) || remove.length > 500) throw new ExportError('badEdit', 400)
  let previous = 0
  for (const span of remove) {
    if (!span || !numberIn(span.start, previous, 864000) || !numberIn(span.end, span.start + 0.001, 864000)) {
      throw new ExportError('badEdit', 400)
    }
    previous = span.end
  }
  if (frame !== undefined && (!frame || typeof frame !== 'object' || !Object.hasOwn(frameSizes, frame.mode) ||
      !numberIn(frame.zoom, 1, 3) || !numberIn(frame.x, -1, 1) || !numberIn(frame.y, -1, 1))) {
    throw new ExportError('badEdit', 400)
  }
  let track
  if (frame?.track !== undefined) {
    if (!Array.isArray(frame.track) || frame.track.length > 85) throw new ExportError('badEdit', 400)
    let time = -1
    track = frame.track.map(point => {
      if (!point || !numberIn(point.time, 0, 864000) || point.time - time < .001 || !numberIn(point.x, -1, 1)) throw new ExportError('badEdit', 400)
      time = point.time
      return { time, x: point.x }
    })
  }
  if (frame?.fit !== undefined && (frame.fit !== 'contain' || frame.track?.length)) throw new ExportError('badEdit', 400)
  return { frame: frame && { mode: frame.mode, zoom: frame.zoom, x: frame.x, y: frame.y,
    ...(frame.fit ? { fit: frame.fit } : {}), ...(track?.length ? { track } : {}) }, remove, encoder }
}

export function keptSpans(start, end, removed) {
  let cursor = start
  const spans = []
  for (const cut of removed) {
    if (cut.end <= cursor || cut.start >= end) continue
    if (cut.start > cursor) spans.push({ start: cursor, end: cut.start })
    cursor = Math.min(end, cut.end)
  }
  if (end > cursor) spans.push({ start: cursor, end })
  return spans.filter(span => span.end - span.start >= 1 / 30)
}

export function outputSize(frame, profile) {
  const [width, height] = frameSizes[frame?.mode ?? 'landscape']
  const scale = (profile?.resolution ?? 1080) / 1080
  return [Math.round(width * scale), Math.round(height * scale)]
}

export function frameFilter(frame, profile, start = 0) {
  if (!frame && !profile) return 'pad=ceil(iw/2)*2:ceil(ih/2)*2'
  const [width, height] = outputSize(frame, profile)
  if (!frame || frame.fit === 'contain') return 'scale=w=' + width + ':h=' + height +
    ':force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1:flags=lanczos,pad=' +
    width + ':' + height + ':(ow-iw)/2:(oh-ih)/2'
  const ratio = width / height
  const zoom = frame.zoom.toFixed(4)
  let horizontal = ((frame.x + 1) / 2).toFixed(4)
  if (frame.track?.length) {
    const points = frame.track.map(point => [point.time - start, (1 + point.x) / 2])
    let expression = points.at(-1)[1].toFixed(4)
    for (let i = points.length - 2; i >= 0; i--) {
      const [t, x] = points[i], [next, end] = points[i + 1]
      const linear = x.toFixed(4) + '+(' + (end - x).toFixed(4) + ')*clip((t-(' + t.toFixed(6) + '))/' + (next - t).toFixed(6) + ',0,1)'
      expression = 'if(lt(t,' + next.toFixed(6) + '),' + linear + ',' + expression + ')'
    }
    horizontal = expression.replaceAll(',', '\\,')
  }
  const vertical = ((frame.y + 1) / 2).toFixed(4)
  // Crop in the decoded sample coordinate system, accounting for non-square source pixels.
  return 'crop=w=min(iw\\,ih*' + ratio + '/sar)/' + zoom +
    ':h=min(ih\\,iw*sar/' + ratio + ')/' + zoom +
    ':x=(iw-ow)*(' + horizontal + '):y=(ih-oh)*' + vertical +
    ',scale=' + width + ':' + height + ':flags=lanczos,setsar=1'
}

export async function analyzeSilence({ input, format, signal, analysis, onProgress }) {
  let info
  try {
    info = await probe(input, format, signal)
  } catch {
    signal.throwIfAborted()
    throw new ExportError('badSource')
  }
  const duration = Number(info.format?.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new ExportError('badSource')
  if (!info.streams?.some(stream => stream.codec_type === 'audio')) throw new ExportError('noAudio')
  const silences = []
  let start
  const add = (from, to) => {
    if (silences.length >= 4000) return
    const left = Math.max(0, from)
    const right = Math.min(to, duration)
    if (right > left) silences.push({ start: left, end: right })
  }
  await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-nostats', '-threads', '2', '-filter_threads', '1',
    '-progress', 'pipe:2', '-stats_period', '0.25', ...inputOptions(format), '-i', input,
    '-map', '0:a:0', '-vn', '-af', 'silencedetect=noise=' + analysis.threshold + 'dB:d=' + analysis.minimum,
    '-f', 'null', '-',
  ], signal, line => {
    const begin = /silence_start:\s*(-?[\d.]+)/.exec(line)
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line)
    if (begin) start = Number(begin[1])
    if (end && start !== undefined) {
      add(start, Number(end[1]))
      start = undefined
    }
    if (line.startsWith('out_time_us=')) {
      const micros = Number(line.slice(12))
      if (Number.isFinite(micros)) onProgress(Math.max(0, Math.min(99, micros / duration / 10000)))
    }
  }, { stderrLines: true })
  if (start !== undefined) add(start, duration)
  return { silences, truncated: silences.length === 4000 }
}
