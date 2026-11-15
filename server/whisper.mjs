import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import { availableParallelism, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ExportError, inputOptions, probe, run } from './media.mjs'
import { ffmpegThreads } from './resource-budget.mjs'

const root = join(process.env.LOCALAPPDATA ?? homedir(), 'ViralCutAI')
const model = join(root, 'ggml-base-q5_1.bin')
const chunkLength = 300
let verifiedModel

async function findEngine(directory) {
  for (const item of await readdir(directory, { recursive: true }).catch(() => [])) {
    if (/^whisper-cli\.exe$/i.test(item.split(/[\\/]/).at(-1))) return join(directory, item)
  }
}

async function engines() {
  const path = process.env.VIRALCUT_MODEL ?? model
  const [cuda, cpu, modelSize] = await Promise.all([
    findEngine(join(root, 'whisper-cuda')),
    findEngine(process.env.VIRALCUT_WHISPER_CPU ?? join(root, 'whisper-cpu')),
    stat(path).catch(() => null),
  ])
  return { cuda, cpu, path, modelPresent: modelSize?.size === 59707625 && modelSize.isFile() }
}

export async function modelVerified(path = process.env.VIRALCUT_MODEL ?? model, signal) {
  try {
    signal?.throwIfAborted()
    const file = await stat(path, { bigint: true })
    if (!file.isFile() || file.size !== 59707625n) return false
    const stamp = [path, file.dev, file.ino, file.size, file.mtimeNs, file.ctimeNs].join('\0')
    if (stamp === verifiedModel) return true
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path, { signal })) hash.update(chunk)
    const after = await stat(path, { bigint: true })
    if ([path, after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].join('\0') !== stamp) return false
    if (hash.digest('hex') !== '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898') return false
    verifiedModel = stamp
    return true
  } catch {
    signal?.throwIfAborted()
    return false
  }
}

export async function whisperAvailability({ verify = false } = {}) {
  const { cuda, cpu, path, modelPresent } = await engines()
  const candidates = [cpu, cuda].filter(Boolean)
  const enginePresent = verify
    ? (await Promise.all(candidates.map(engine =>
      run(engine, ['--version'], AbortSignal.timeout(8000), undefined, { cwd: dirname(engine) })
        .then(() => true, () => false)))).some(Boolean)
    : candidates.length > 0
  const validModel = modelPresent && await modelVerified(path)
  return { available: enginePresent && validModel, modelPresent: validModel, enginePresent, gpuInstalled: Boolean(cuda) }
}

function timing(part, low, high) {
  const start = Number(part?.offsets?.from) / 1000
  const end = Number(part?.offsets?.to) / 1000
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const clamped = { start: Math.max(start, low), end: Math.min(end, high) }
  return clamped.end > clamped.start ? clamped : null
}

export function parseCues(result, offset, length, leadingSilence = 0) {
  const cues = []
  for (const entry of result.transcription ?? []) {
    const interval = timing(entry, leadingSilence, length)
    const text = entry.text?.trim()
    if (!interval || !text || text.length > 500 ||
        /^(?:\[[^\]]+\]|\([^()]+\)|[♪♫\s]+)$/.test(text)) continue
    const pieces = []
    let valid = true
    for (const token of entry.tokens ?? []) {
      if (!token.text || /^\[_.*\]$/.test(token.text)) continue
      const timed = timing(token, interval.start, interval.end)
      if (/^\s+\S/u.test(token.text) || !pieces.length) pieces.push({ text: '', start: Infinity, end: -Infinity })
      const word = pieces.at(-1)
      word.text += token.text
      if (timed) {
        word.start = Math.min(word.start, timed.start)
        word.end = Math.max(word.end, timed.end)
      }
    }
    if (pieces.length) {
      pieces[0].text = pieces[0].text.trimStart()
      pieces.at(-1).text = pieces.at(-1).text.trimEnd()
    }
    let previous = interval.start
    for (const word of pieces) {
      if (word.start < previous && previous - word.start <= .06 && word.end > previous + .02) word.start = previous
      if (!word.text || word.text.length > 160 || !Number.isFinite(word.start) ||
          word.start < previous || word.end <= word.start) valid = false
      previous = word.end
    }
    const words = valid && pieces.length > 0 && pieces.length <= 120 && pieces.map(word => word.text).join('') === text
      ? pieces.map(word => ({ ...word, start: word.start + offset, end: word.end + offset })) : undefined
    if (!words || (text.length <= 84 && interval.end - interval.start <= 7)) {
      cues.push({ start: interval.start + offset, end: interval.end + offset, text, words })
      continue
    }
    let first = 0, characters = 0
    for (let index = 0; index < words.length; index++) {
      const word = words[index]
      characters += word.text.length
      const next = words[index + 1]
      if (next && characters + next.text.length <= 84 && next.end - words[first].start <= 7 &&
          !(characters >= 27 && /[.!?…]$/u.test(word.text))) continue
      const block = words.slice(first, index + 1)
      block[0] = { ...block[0], text: block[0].text.trimStart() }
      cues.push({ start: first === 0 ? interval.start + offset : block[0].start,
        end: next ? word.end : interval.end + offset, text: block.map(item => item.text).join(''), words: block })
      first = index + 1
      characters = 0
    }
  }
  return cues
}

export async function transcribe({ input, directory, format, language, device, signal, onProgress, voice = false }) {
  const { cuda, cpu, path, modelPresent } = await engines()
  if (!modelPresent || !(cuda || cpu) || !await modelVerified(path, signal)) throw new ExportError('whisperUnavailable', 503)
  const info = await probe(input, format, signal).catch(error => {
    signal.throwIfAborted()
    if (error.code === 'ENOENT') throw new ExportError('toolsUnavailable', 503)
    throw new ExportError('badSource')
  })
  if (!info.streams?.some(stream => stream.codec_type === 'audio')) throw new ExportError('noAudio')
  const duration = Number(info.format?.duration)
  // Live MediaRecorder WebM often has no container duration. FFmpeg stops at EOF.
  const limit = voice ? 18 : duration
  if ((!voice && !Number.isFinite(limit)) || limit <= 0) throw new ExportError('badSource')
  const wav = join(directory, 'audio.wav')
  const output = join(directory, 'transcript')
  const threads = ffmpegThreads(Math.max(1, Math.min(4, availableParallelism() - 2)))
  const cues = []
  const detected = new Set()
  const used = new Set()
  let preferGpu = device === 'auto' && Boolean(cuda)
  for (let offset = 0; offset < limit; offset += chunkLength) {
    signal.throwIfAborted()
    const length = Math.min(chunkLength, limit - offset)
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '2',
      ...inputOptions(format), '-ss', offset.toFixed(6), '-i', input, '-t', length.toFixed(6),
      '-vn', '-map', '0:a:0', '-af', 'aresample=16000:first_pts=0', '-ac', '1', '-c:a', 'pcm_s16le', wav,
    ], signal)
    // Skip empty PCM chunks. An audio track may end before the video does.
    if ((await stat(wav)).size <= 100) {
      onProgress(Math.min(99, (offset + length) / limit * 100))
      continue
    }
    let leadingSilence = 0
    let startsSilent = false
    let firstSilenceEnded = false
    await run('ffmpeg', [
      '-hide_banner', '-nostdin', '-i', wav, '-af', 'silencedetect=n=-42dB:d=0.3', '-f', 'null', '-',
    ], signal, line => {
      if (/silence_start: 0(?:\s|$)/.test(line) && !firstSilenceEnded) startsSilent = true
      const match = /silence_end:\s*([\d.]+)/.exec(line)
      if (match && !firstSilenceEnded) {
        firstSilenceEnded = true
        if (startsSilent) leadingSilence = Number(match[1])
      }
    }, { stderrLines: true })
    if (leadingSilence >= length - 0.02) {
      onProgress(Math.min(99, (offset + length) / limit * 100))
      continue
    }
    const invoke = async (engine, gpu) => {
      await unlink(output + '.json').catch(error => { if (error.code !== 'ENOENT') throw error })
      let ranOnGpu = false
      await run(engine, [
        '-m', path, '-f', wav, '-l', language, '-t', threads, '-ojf',
        '-ml', '60', '-sow', '-pp', '-sns', '-of', output, ...(gpu ? [] : ['-ng']),
      ], signal, line => {
        const progress = /progress\s*=\s*(\d+)%/.exec(line)
        if (progress) onProgress(Math.min(99, (offset + length * Number(progress[1]) / 100) / limit * 100))
        if (/using (?:CUDA\d*|Vulkan\d*) backend|using (?:CUDA\d*|Vulkan\d*) device/i.test(line)) ranOnGpu = true
      }, { stderrLines: true, cwd: dirname(engine) })
      const report = output + '.json'
      if ((await stat(report)).size > 32 * 1024 * 1024) throw new ExportError('transcriptFailed')
      return { result: JSON.parse(await readFile(report, 'utf8')), backend: ranOnGpu ? 'GPU' : 'CPU' }
    }
    let response
    try {
      response = await invoke(preferGpu ? cuda : cpu ?? cuda, preferGpu)
    } catch {
      signal.throwIfAborted()
      if (!preferGpu) throw new ExportError('transcriptFailed')
      preferGpu = false
      response = await invoke(cpu ?? cuda, false).catch(() => {
        signal.throwIfAborted()
        throw new ExportError('transcriptFailed')
      })
    }
    used.add(response.backend)
    if (response.backend === 'CPU') preferGpu = false
    if (response.result.result?.language) detected.add(response.result.result.language)
    cues.push(...parseCues(response.result, offset, length, leadingSilence))
    if (cues.length > 10000) throw new ExportError('tooManyCues')
    onProgress(Math.min(99, (offset + length) / limit * 100))
  }
  return { cues, languages: [...detected], backend: [...used].join(' / ') || 'CPU' }
}
