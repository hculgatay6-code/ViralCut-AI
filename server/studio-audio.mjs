import { ExportError, inputOptions, run } from './media.mjs'

export function studioAudioSettings(value) {
  if (value === undefined) return
  if (!value || !Number.isFinite(value.target) || value.target < -24 || value.target > -14 ||
      !Number.isFinite(value.musicLevel) || value.musicLevel < 0 || value.musicLevel > .35) throw new ExportError('badEdit', 400)
  return { target: value.target, musicLevel: value.musicLevel }
}

export function loudnessReader() {
  let record = ''
  return {
    line(line) { if (line === '{' || (record && !record.endsWith('}'))) record = (line === '{' ? '' : record) + line },
    result() {
      const report = JSON.parse(record)
      const number = value => Number.isFinite(Number(value)) ? Number(value) : null
      return { integrated: number(report.input_i), peak: number(report.input_tp), range: number(report.input_lra) }
    },
  }
}

export async function measureLoudness(file, signal, extra = [], input = inputOptions('mp4')) {
  const reader = loudnessReader()
  await run('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'info', ...input, '-i', file, ...extra,
    '-map', '0:a:0', '-vn', '-af', 'loudnorm=I=-16:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'], signal, reader.line, { stderrLines: true })
  return reader.result()
}

export async function masterStudioAudio(input, output, duration, sourceAudio, settings, music, signal) {
  const source = ['-protocol_whitelist', 'file', '-f', 'matroska', '-i', input]
  const audio = sourceAudio || music
  const bed = music ? ['-stream_loop', '-1', '-protocol_whitelist', 'file', '-f', music.format,
    ...(music.format === 'mov' ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : []), '-i', music.path] : []
  const fade = Math.min(.55, duration / 4)
  const bedFilter = `[1:a:0]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${settings.musicLevel},afade=d=${fade},afade=t=out:st=${duration - fade}:d=${fade}[bed]`
  let graph = music ? bedFilter + (sourceAudio ?
    ';[0:a:0]aresample=48000,aformat=channel_layouts=stereo,asplit=2[main][key];[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=25:release=320[duck];[main][duck]amix=inputs=2:duration=first:normalize=0[program]' :
    ';[bed]anull[program]') : '[0:a:0]anull[program]'
  if (audio) {
    const target = sourceAudio ? settings.target : Math.min(settings.target, -20)
    graph += `;[program]loudnorm=I=${target}:LRA=11:TP=-2:print_format=none,aresample=48000[a]`
  }
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-n', ...source, ...bed,
    '-map', '0:v:0', '-t', String(duration), '-c:v', 'copy',
    ...(audio ? ['-filter_complex_threads', '1', '-filter_complex', graph, '-map', '[a]', '-c:a', 'aac', '-b:a', '256k'] : []),
    '-movflags', '+faststart', '-f', 'mp4', output], signal)
}
