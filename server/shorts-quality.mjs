import { ExportError, inputOptions, probe, run } from './media.mjs'
import { keptSpans, outputSize } from './shorts.mjs'
import { loudnessReader } from './studio-audio.mjs'

export async function measureShorts({ input, format, duration, signal, onProgress }) {
  const stride = Math.max(1, Math.ceil(duration / 7200))
  const energy = [], scenes = []
  let time = 0
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', '-filter_threads', '1',
    ...inputOptions(format), '-i', input, '-t', String(duration), '-map', '0:V:0', '-map', '0:a:0',
    '-vf', 'fps=4,scale=160:-2:flags=fast_bilinear,scdet=t=12,metadata=print:key=lavfi.scd.time:file=-',
    '-af', `aresample=8000,asetnsamples=n=${8000 * stride}:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`,
    '-progress', 'pipe:1', '-f', 'null', '-'], signal, line => {
    const frame = /pts_time:([-\d.]+)/.exec(line)
    if (frame) time = Number(frame[1])
    else if (line.startsWith('lavfi.astats.Overall.RMS_level=') && energy.length < 7300) {
      const db = Number(line.split('=')[1])
      energy.push({ time, db: Number.isFinite(db) ? db : -90 })
    } else if (line.startsWith('lavfi.scd.time=') && scenes.length < 12000) {
      const scene = Number(line.split('=')[1])
      if (Number.isFinite(scene)) scenes.push(scene)
    } else if (line.startsWith('out_time_us=')) {
      const seconds = Number(line.slice(12)) / 1e6
      if (Number.isFinite(seconds)) onProgress(Math.min(99, 100 * seconds / duration))
    }
  })
  return { energy: energy.sort((a, b) => a.time - b.time), scenes: scenes.sort((a, b) => a - b), stride }
}

export async function verifyShort(output, settings, signal, expectAudio = true, result) {
  const [width, height] = outputSize(settings.edit.frame ?? { mode: 'vertical' }, settings.profile)
  const info = await probe(output, 'mp4', signal)
  const video = info.streams.find(stream => stream.codec_type === 'video')
  const audio = info.streams.find(stream => stream.codec_type === 'audio')
  if (expectAudio && !audio) throw new ExportError('noAudio')
  const length = keptSpans(settings.start, settings.end, settings.edit.remove).reduce((sum, span) => sum + span.end - span.start, 0)
  const duration = Number(info.format.duration)
  const [frames, seconds] = (video?.avg_frame_rate ?? '').split('/').map(Number)
  const streamDelta = audio ? Math.abs(Number(audio.duration) - Number(video?.duration)) : 0
  if (!Number.isFinite(duration) || Math.abs(duration - length) > .15 || !video || video.codec_name !== 'h264' ||
      (audio && audio.codec_name !== 'aac') || !Number.isFinite(streamDelta) || streamDelta > .15 ||
      !seconds || Math.abs(frames / seconds - (settings.profile.fps ?? 30)) > .35 || video.width !== width ||
      video.height !== height) throw new ExportError('verifyFailed')
  let blackSeconds = 0
  let audible = false, silentSeconds = 0
  const loudness = result && settings.mastering && audio ? loudnessReader() : undefined
  try {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-xerror', '-nostdin', '-threads', '2', '-filter_threads', '1',
      ...inputOptions('mp4'), '-i', output, '-map', '0:v:0',
      '-vf', 'blackdetect=d=0.4:pix_th=0.08:pic_th=0.97', ...(loudness ? ['-filter_complex_threads', '1',
        '-filter_complex', '[0:a:0]asplit=2[levels][loud];[levels]silencedetect=n=-48dB:d=1.5,volumedetect[checked];[loud]loudnorm=I=-16:TP=-2:LRA=11:print_format=json,anullsink',
        '-map', '[checked]'] : audio ? ['-map', '0:a:0', '-af', 'volumedetect'] : []),
      '-f', 'null', '-'], signal, line => {
      loudness?.line(line)
      const black = /black_duration:([\d.]+)/.exec(line)
      if (black) blackSeconds += Number(black[1])
      const silence = /silence_duration:\s*([\d.]+)/.exec(line)
      if (silence) silentSeconds += Number(silence[1])
      const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(line)
      if (peak && Number(peak[1]) > -65) audible = true
    }, { stderrLines: true })
  } catch {
    signal.throwIfAborted()
    throw new ExportError('clipDecodeFailed')
  }
  const warnings = []
  if (blackSeconds >= .4) warnings.push('blackFrames')
  if (audio && !audible) warnings.push('quietOutput')
  if (result && settings.mastering) {
    result.quality = { blackSeconds, silentSeconds, avDeltaMs: Math.round(streamDelta * 1000) }
    if (loudness) {
      const levels = loudness.result()
      Object.assign(result.quality, levels)
      if ((levels.peak ?? -100) > -1) warnings.push('loudPeak')
      if (levels.integrated !== null && Math.abs(levels.integrated - (expectAudio && settings.musicOnly ? Math.min(settings.mastering.target, -20) : settings.mastering.target)) > 3) warnings.push('loudnessDeviation')
      if (silentSeconds > Math.max(2, length * .2)) warnings.push('longSilence')
    }
    const cues = settings.overlay?.cues ?? []
    if (cues.some(cue => cue.text.trim().length / (cue.end - cue.start) > 24)) warnings.push('fastCaptions')
  }
  return warnings
}
