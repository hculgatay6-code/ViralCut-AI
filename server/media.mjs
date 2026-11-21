import { spawn } from 'node:child_process'
import { stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildAss } from './ass.mjs'
import { audioEffects, videoEdgeFade, videoEffects } from './effects.mjs'
import { frameFilter, keptSpans, outputSize } from './shorts.mjs'
import { masterStudioAudio } from './studio-audio.mjs'
import { fastDecode, ffmpegThreads } from './resource-budget.mjs'

export class ExportError extends Error {
  constructor(code, status = 422) {
    super(code)
    this.status = status
  }
}

const mediaProcesses = { ffmpeg: 0, ffprobe: 0 }
export const mediaActivity = () => ({ ...mediaProcesses })

export function run(program, args, signal, onLine, { stderrLines = false, cwd } = {}) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const executable = program === 'ffmpeg' ? process.env.VIRALCUT_FFMPEG ?? program
      : program === 'ffprobe' ? process.env.VIRALCUT_FFPROBE ?? program : program
    const child = spawn(executable, args, {
      shell: false, windowsHide: true, signal, cwd, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const track = program === 'ffmpeg' || program === 'ffprobe'
    if (track) mediaProcesses[program]++
    let failure
    let stdout = ''
    let stderr = ''
    let partial = ''
    child.on('error', error => { failure = error })
    function emitLines(data) {
      const lines = (partial + data).split('\n')
      partial = lines.pop().slice(-4096)
      for (const line of lines) onLine(line.trim())
    }
    child.stderr.setEncoding('utf8').on('data', data => {
      stderr = (stderr + data).slice(-8192)
      if (onLine && stderrLines) emitLines(data)
    })
    child.stdout.setEncoding('utf8').on('data', data => {
      if (!onLine || stderrLines) {
        stdout = (stdout + data).slice(-65536)
        return
      }
      emitLines(data)
    })
    child.on('close', code => {
      if (track) mediaProcesses[program]--
      if (failure) reject(failure)
      else if (code === 0) resolve(stdout)
      else reject(new ExportError(/no space left|disk full|not enough space/i.test(stderr) ? 'diskFull' : 'encodeFailed'))
    })
  })
}

export function inputOptions(format) {
  if (format === 'mp3' || format === 'wav') return ['-protocol_whitelist', 'file', '-f', format]
  const mov = format === 'mp4' || format === 'm4a'
  return ['-protocol_whitelist', 'file', '-f', mov ? 'mov' : 'matroska',
    ...(mov ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : [])]
}

export async function probe(file, format, signal) {
  return JSON.parse(await run('ffprobe', [
    '-v', 'error', ...inputOptions(format), '-show_entries',
    'format=duration:stream=codec_type,width,height,codec_name,avg_frame_rate,nb_frames,duration,start_time,sample_aspect_ratio,color_transfer:stream_disposition=attached_pic:stream_side_data=rotation',
    '-of', 'json', '-i', file,
  ], AbortSignal.any([signal, AbortSignal.timeout(45000)])))
}

function hasVideo(info) {
  return info.streams?.some(stream =>
    stream.codec_type === 'video' && stream.width > 0 && stream.height > 0 && !stream.disposition?.attached_pic)
}

export async function checkTools({ subtitles = false, timeoutMs = 8000 } = {}) {
  try {
    const signal = AbortSignal.timeout(timeoutMs)
    const [encoders, , filters] = await Promise.all([
      run('ffmpeg', ['-hide_banner', '-encoders'], signal),
      run('ffprobe', ['-version'], signal),
      subtitles ? run('ffmpeg', ['-hide_banner', '-filters'], signal) : '',
    ])
    return /\blibx264\s/.test(encoders) && /\baac\s/.test(encoders) && (!subtitles || /\bass\s+V->V/.test(filters))
  } catch {
    return false
  }
}

export function encoderArgs(gpu, profile) {
  const quality = { quality: 17, balanced: 20, small: 25 }[profile?.quality]
  const rate = profile?.bitrate ? ['-b:v', profile.bitrate + 'k'] : []
  return gpu
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', ...(rate.length ? rate : ['-cq', String(quality ?? 19), '-b:v', '0'])]
    : ['-c:v', 'libx264', '-threads:v', ffmpegThreads(4), '-preset', 'fast', ...(rate.length ? rate : ['-crf', String(quality ?? 18)])]
}

export async function encodeClip({ input, output, format, start, end, signal, onProgress, overlay, directory, edit, profile, effects, edgeFade = 0, mastering, music,
  sourceInfo, allowHardwareDecode = true }) {
  let info
  try {
    info = sourceInfo ?? await probe(input, format, signal)
  } catch (error) {
    signal.throwIfAborted()
    if (error.code === 'ENOENT') throw new ExportError('toolsUnavailable', 503)
    throw new ExportError('badSource')
  }
  const sourceDuration = Number(info.format?.duration)
  if (!hasVideo(info) || !Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new ExportError('badSource')
  // Container duration can differ slightly from the browser's reported duration.
  if (start >= sourceDuration || end > sourceDuration + 0.05) throw new ExportError('badRange')
  const spans = edit?.remove.length ? keptSpans(start, Math.min(end, sourceDuration), edit.remove)
    : [{ start, end: Math.min(end, sourceDuration) }]
  if (!spans.length) throw new ExportError('emptyEdit')
  const duration = spans.reduce((sum, span) => sum + span.end - span.start, 0)
  const multiple = spans.length > 1
  let elapsed = 0
  const useGpu = edit ? edit.encoder === 'auto' : !!profile
  const videoStream = info.streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
  const decode = allowHardwareDecode && useGpu && videoStream.width >= 1920 && ['h264', 'hevc'].includes(videoStream.codec_name) ? fastDecode() : undefined
  const parts = []
  const hasAudio = info.streams.some(stream => stream.codec_type === 'audio')
  const mastered = mastering && (hasAudio || music)
  const intermediate = mastered ? join(directory, 'studio-picture.mkv') : output
  const [width, height] = edit?.frame || profile ? outputSize(edit?.frame, profile) : (() => {
    const video = info.streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
    return [Math.ceil(video.width / 2) * 2, Math.ceil(video.height / 2) * 2]
  })()
  for (const [index, span] of spans.entries()) {
    signal.throwIfAborted()
    if (overlay) await writeFile(join(directory, 'caption.ass'), buildAss(overlay, span.start, span.end, edit?.frame))
    const length = span.end - span.start
    const first = index === 0, last = index === spans.length - 1
    const filters = frameFilter(edit?.frame, profile, span.start) + (profile ? ',fps=' + profile.fps : '') +
      videoEffects(effects, span.start, profile?.fps ?? 30, width, height) +
      (edgeFade ? videoEdgeFade(length, edgeFade, first, last) : '') + (overlay ? ',ass=caption.ass' : '')
    const audio = audioEffects(effects, length, { first, last, edge: edgeFade })
    const name = 'part-' + parts.length + '.mkv'
    const target = multiple ? join(directory, name) : intermediate
    if (multiple) parts.push(name)
    const encode = gpu => run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-n',
      '-progress', 'pipe:1', '-stats_period', '0.25', '-filter_threads', '2',
      '-threads', ffmpegThreads(4), ...(decode ? ['-hwaccel', decode] : []), ...inputOptions(format), '-ss', span.start.toFixed(6), '-i', input, '-t', length.toFixed(6),
      '-map', '0:V:0', '-map', multiple || mastered ? '0:a:0?' : '0:a?', '-map_chapters', '-1', '-map_metadata', '-1',
      '-vf', filters, '-fps_mode', 'vfr', '-pix_fmt', 'yuv420p',
      ...encoderArgs(gpu, profile),
      ...(hasAudio && (multiple || audio || mastered) ?
        ['-af', 'aresample=48000:first_pts=0' + audio + (multiple || mastered ? ',apad' : '')] : []),
      ...(multiple || mastered ? ['-c:a', 'pcm_s16le', '-f', 'matroska'] : ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-f', 'mp4']), target,
    ], signal, line => {
      if (!line.startsWith('out_time_us=')) return
      const micros = Number(line.slice(12))
      if (Number.isFinite(micros)) onProgress(Math.max(0, Math.min(94, (elapsed + micros / 1000000) / duration * 94)))
    }, { cwd: directory })
    try {
      await encode(useGpu)
    } catch (error) {
      signal.throwIfAborted()
      if ((!useGpu && !decode) || error.message === 'diskFull') throw error
      // Keep codec parameters constant across all pieces when falling back.
      for (const part of parts) await unlink(join(directory, part)).catch(() => {})
      if (!multiple) await unlink(intermediate).catch(() => {})
      return encodeClip({ input, output, format, start, end, signal, onProgress, overlay, directory, profile, effects, edgeFade,
        mastering, music, sourceInfo: info, allowHardwareDecode: false,
        edit: { ...edit, remove: edit?.remove ?? [], encoder: decode ? 'auto' : 'cpu' } })
    }
    elapsed += length
  }

  if (multiple) {
    const list = parts.map((name, i) => 'file ' + name + '\nduration ' + (spans[i].end - spans[i].start).toFixed(6)).join('\n')
    await writeFile(join(directory, 'parts.txt'), list + '\n', { flag: 'wx' })
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
      '-protocol_whitelist', 'file', '-f', 'concat', '-safe', '1', '-i', 'parts.txt',
      '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-af', 'aresample=48000:async=1:first_pts=0',
      ...(mastered ? ['-c:a', 'pcm_s16le', '-f', 'matroska'] : ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-f', 'mp4']), intermediate],
    signal, undefined, { cwd: directory })
  }
  if (mastered) await masterStudioAudio(intermediate, output, duration, hasAudio, mastering, music, signal)
  const [encoded, size] = await Promise.all([probe(output, 'mp4', signal), stat(output)])
  if (!hasVideo(encoded) || !(Number(encoded.format?.duration) > 0) || size.size <= 0) {
    throw new ExportError('encodeFailed')
  }
  const video = encoded.streams.find(stream => stream.codec_type === 'video')
  const audio = encoded.streams.find(stream => stream.codec_type === 'audio')
  const measured = Number(encoded.format.duration)
  if (profile || edit?.frame) {
    const [width, height] = outputSize(edit?.frame, profile)
    if (video.width !== width || video.height !== height || video.codec_name !== 'h264' ||
        ((hasAudio || music) && audio?.codec_name !== 'aac') || Math.abs(measured - duration) > Math.max(.17, spans.length * .05)) {
      throw new ExportError('verifyFailed')
    }
  }
  const [frames, seconds] = (video.avg_frame_rate ?? '0/1').split('/').map(Number)
  return { size: size.size, encoder: useGpu ? 'NVENC' : 'CPU', decoder: decode ?? 'cpu', sourceAudio: hasAudio, verification: {
    duration: measured, width: video.width, height: video.height, fps: seconds ? Math.round(frames / seconds * 100) / 100 : 0,
    captions: !!overlay?.cues.some(cue => spans.some(span => cue.start < span.end && cue.end > span.start)),
    audio: !!audio,
  } }
}
