import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { link, mkdtemp, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { validateOverlay } from './ass.mjs'
import { analyzeSilence, validateAnalysis, validateEdit, validateProfile } from './shorts.mjs'
import { encodeClip, ExportError, inputOptions, probe, run } from './media.mjs'
import { transcribe } from './whisper.mjs'
import { validateEffects } from './effects.mjs'
import { measureShorts, verifyShort } from './shorts-quality.mjs'
import { rankVisual, subjectTrack, visualMetrics, visualWindow } from './visual-ranking.mjs'
import { studioAudioSettings } from './studio-audio.mjs'
import { creatorProfile, validatePlatformMedia } from './creator.mjs'

export async function analyzeShorts(options) {
  const { onProgress, onStage = () => {}, semantic, goal, signal, vision, visualMode, visualDevice, director } = options
  const ranked = goal !== undefined
  const info = await probe(options.input, options.format, signal)
  const duration = Number(info.format?.duration)
  if (!(duration > 0) || !info.streams.some(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)) throw new ExportError('badSource')
  const hasAudio = info.streams.some(stream => stream.codec_type === 'audio')
  onStage('silence')
  const pauses = hasAudio ? await analyzeSilence({ ...options, onProgress: value => onProgress(value * .09) }) : { silences: [], truncated: false }
  onStage('speech')
  onProgress(9)
  const speechDefault = { cues: [], languages: [], backend: '' }
  let speechUnavailable = false
  const transcript = hasAudio && !(pauses.silences.length === 1 && pauses.silences[0].end - pauses.silences[0].start >= duration - .04)
    ? await transcribe({ ...options, onProgress: value => onProgress(9 + value * (ranked ? .53 : .91)) }).catch(error => {
      if (!ranked || !['whisperUnavailable', 'transcriptFailed'].includes(error.message)) throw error
      speechUnavailable = true
      return speechDefault
    }) : speechDefault
  if (!ranked) return { ...pauses, ...transcript }
  onStage('vision')
  onProgress(62)
  const visual = await vision({ ...options, duration, device: visualDevice,
    onProgress: value => onProgress(62 + value * .20) }).catch(error => {
      signal.throwIfAborted()
      if (!transcript.cues.length) throw error
      return { rows: [], detections: [], models: ['failed', 'failed'], step: 0, detectionStep: 0 }
    })
  onStage('media')
  onProgress(82)
  const signals = hasAudio ? await measureShorts({ ...options, duration, onProgress: value => onProgress(82 + value * .08) }).catch(() => {
    signal.throwIfAborted()
    return undefined
  }) : undefined
  onStage('ranking')
  onProgress(90)
  const selection = transcript.cues.length && visualMode !== 'gaming' ?
    await semantic.analyze({ cues: transcript.cues, silences: pauses.silences, duration, goal, signals, visualRows: visual.rows, director }, signal, onProgress) : null
  const video = info.streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
  const selected = selection?.candidates.length ? selection.candidates.map(item => ({ ...item,
    visual: visualMetrics(visual.rows, item.start, item.end) })) :
    (goal === 0 ? [15, 30, 60] : [goal]).flatMap(length =>
      rankVisual(visual.rows, duration, length, visualMode === 'gaming', signals?.energy, director ? 10 : 5))
  const candidates = selected.map((item, id) => {
    const ratio = video.width / video.height
    const track = visualMode === 'gaming' ? [] : subjectTrack(visual.detections, item.start, item.end, ratio, director)
    if (!director) return { ...item, id, track }
    const frames = visualWindow(visual.rows, item.start, item.end)
    const mean = key => frames.length ? frames.reduce((sum, row) => sum + (row[key] ?? 0), 0) / frames.length : 0
    const cuts = frames.filter(row => row.cut).map(row => row.time)
    const faces = visualWindow(visual.detections, item.start, item.end)
      .flatMap(row => row.boxes.filter(box => box.label === 'face').map(box => ({ time: row.time, left: box.left, right: box.right })))
    return { ...item, id, track, picture: frames.length ? { light: mean('light'), bright: mean('bright'), tint: mean('tint'),
      cuts, wideFaces: faces.some(box => box.right - box.left > (9 / 16) / ratio) } : undefined }
  })
  const events = visual.rows.filter(row => row.cut || row.burst).slice(0, 160).map(({ time, cut, motion }) => ({ time, cut, motion: Math.round(motion * 100) }))
  return { ...pauses, ...transcript, duration, width: video.width, height: video.height, hasAudio, speechUnavailable, selection: { ...selection, mode: selection?.candidates.length ? selection.mode : 'visual',
    reason: selection?.reason, candidates }, visual: { events, models: visual.models, step: visual.step,
    detectionStep: visual.detectionStep, samples: visual.rows.length, sceneCount: 1 + visual.rows.filter(row => row.cut).length } }
}

export function readShortsAnalysis(settings) {
  const { language, device, analysis, goal, duration, visualMode = 'general', visualDevice = 'auto', director } = settings
  if (!['auto', 'tr', 'en'].includes(language) || !['auto', 'cpu'].includes(device) || !analysis) throw new ExportError('badEdit', 400)
  if (goal !== undefined && (!(director === true ? [0, 15, 30, 60] : [15, 30, 60]).includes(goal) || !Number.isFinite(duration) || duration <= 0 || duration > 864000)) throw new ExportError('badEdit', 400)
  if (!['general', 'gaming'].includes(visualMode) || !['auto', 'cpu'].includes(visualDevice)) throw new ExportError('badEdit', 400)
  return { language, device, analysis: validateAnalysis(analysis), goal, duration, visualMode, visualDevice, director: director === true }
}

export function batchSize(request) {
  return Array.isArray(request?.items) && request.items.length >= 1 && request.items.length <= (request.creator ? 15 : 10) &&
    [720, 1080].includes(request.resolution) && ['auto', 'cpu'].includes(request.encoder)
}

export function validateBatchItem(item, request) {
  const { start, end, frame, remove, overlay } = item ?? {}
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 864000 || end - start < 14.999 || end - start > 60.001 ||
      !frame || frame.mode !== 'vertical' || !Array.isArray(remove) || remove.length > 100 ||
      remove.some(span => !span || span.start < start || span.end > end)) throw new ExportError('badRange')
  const edit = validateEdit({ frame, remove, encoder: request.encoder })
  if (end - start - edit.remove.reduce((sum, span) => sum + span.end - span.start, 0) < 14.999) throw new ExportError('badRange')
  const captions = overlay === undefined ? undefined : validateOverlay(overlay)
  if (captions?.cues.some(cue => cue.start >= end || cue.end <= start)) throw new ExportError('badSubtitles')
  if (item.edgeFade !== undefined && typeof item.edgeFade !== 'boolean') throw new ExportError('badEdit', 400)
  let effects
  try { effects = validateEffects(item.effects) } catch { throw new ExportError('badEdit', 400) }
  const platform = request.creator ? creatorProfile(item.platform, item.preset) : undefined
  if (platform && (request.resolution !== 1080 || end - start > platform.max)) throw new ExportError('badRange', 400)
  if (platform && captions) captions.appearance = { ...captions.appearance, y: Math.min(captions.appearance.y ?? platform.safeY, platform.safeY), safe: true }
  return { start, end, edit, overlay: captions, effects, edgeFade: item.edgeFade ? .25 : 0, mastering: studioAudioSettings(item.mastering), platform,
    profile: validateProfile({ resolution: request.resolution, fps: platform?.fps ?? 30, quality: 'balanced', bitrate: platform?.bitrate ?? 0 }) }
}

async function publish(output, directory, signal, platform) {
  const token = randomUUID()
  const temp = join(directory, '.viralcut-' + token + '.tmp')
  const filename = (platform ? platform + '-' : 'ViralCut-Short-') + token.slice(0, 8) + '.mp4'
  try {
    await pipeline(createReadStream(output), createWriteStream(temp, { flags: 'wx' }), { signal })
    signal.throwIfAborted()
    // A hard link publishes the completely written file without overwriting an existing path.
    await link(temp, join(directory, filename))
    return filename
  } finally { await unlink(temp).catch(() => {}) }
}

export function startShortsBatch(request, source, destination, removeWorkDir, prefix, record = () => {}, retry = false, music) {
  const controller = new AbortController()
  const signal = controller.signal
  const items = request.items.map(() => ({ phase: 'queued', progress: 0 }))
  const id = randomUUID()
  const snapshot = () => ({ id, active: items.some(item => ['queued', 'processing'].includes(item.phase)), items })
  const work = (async () => {
    let sourceMeta, sourceStamp
    for (const [index, raw] of request.items.entries()) {
      const item = items[index]
      const started = performance.now()
      let directory
      try {
        signal.throwIfAborted()
        const input = await stat(source.path).catch(() => null)
        if (!input?.isFile() || input.size !== source.size) throw new ExportError('missingProjectMedia')
        const stamp = [input.dev, input.ino, input.size, input.mtimeMs, input.ctimeMs].join(':')
        if (stamp !== sourceStamp) {
          sourceMeta = await probe(source.path, source.format, signal).catch(() => null)
          if (!sourceMeta) { signal.throwIfAborted(); throw new ExportError('badSource') }
          sourceStamp = stamp
        }
        const settings = validateBatchItem(raw, request)
        item.phase = 'processing'
        let result, output
        for (let attempt = 0; attempt < 2; attempt++) {
          directory = await mkdtemp(join(tmpdir(), prefix + process.pid + '-'))
          output = join(directory, 'output.mp4')
          try {
            result = await encodeClip({ ...settings, music: settings.mastering ? music : undefined, input: source.path, format: source.format, directory, output, signal, sourceInfo: sourceMeta,
              onProgress: value => { item.progress = Math.max(item.progress, Math.min(94, value)) } })
            item.progress = 95
            item.warnings = await verifyShort(output, { ...settings, musicOnly: !result.sourceAudio }, signal,
              result.sourceAudio || !!(settings.mastering && music), item)
            if (settings.platform && !validatePlatformMedia(await probe(output, 'mp4', signal), result.size, settings.platform, result.sourceAudio)) {
              throw new ExportError('verifyFailed')
            }
            break
          } catch (error) {
            signal.throwIfAborted()
            if (!retry || attempt || !['verifyFailed', 'clipDecodeFailed'].includes(error.message)) throw error
            await removeWorkDir(directory)
            directory = undefined
            settings.edit.encoder = 'cpu'
            item.retried = true
            item.progress = 0
          }
        }
        if (settings.platform) item.platform = raw.platform
        item.filename = await publish(output, destination, signal, item.platform)
        if (settings.platform) {
          // Keep media and metadata associated by basename, including when partial batches are cancelled.
          const sidecar = join(destination, item.filename.replace(/\.mp4$/, '.json'))
          const cover = item.filename.replace(/\.mp4$/, '.jpg')
          const image = join(destination, cover)
          const manifest = { platform: item.platform, media: item.filename, profile: settings.platform, metadata: raw.metadata,
            verification: result.verification, warnings: item.warnings, bytes: result.size, cover }
          try {
            await run('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-n', '-threads', '2', ...inputOptions('mp4'),
              '-ss', String(Math.min(8, result.verification.duration * .18)), '-i', output,
              '-vf', 'thumbnail=12', '-frames:v', '1', '-q:v', '3', '-update', '1', image], signal)
            if (!(await stat(image)).size) throw new ExportError('verifyFailed')
            signal.throwIfAborted()
            await writeFile(sidecar, JSON.stringify(manifest, null, 2), { flag: 'wx', flush: true })
          }
          catch (error) {
            await Promise.all([join(destination, item.filename), image, sidecar].map(path => unlink(path).catch(() => {})))
            item.filename = undefined
            throw error
          }
        }
        item.encoder = result.encoder
        item.decoder = result.decoder
        item.verification = result.verification
        item.progress = 100
        item.phase = 'ready'
      } catch (error) {
        item.phase = signal.aborted ? 'cancelled' : 'failed'
        if (!signal.aborted) item.error = error instanceof ExportError ? error.message : error.code === 'ENOSPC' ? 'diskFull'
          : ['EACCES', 'EPERM', 'EROFS'].includes(error.code) ? 'accessDenied' : 'saveFailed'
      } finally {
        record('batch', item.phase, started, item.error)
        if (directory) await removeWorkDir(directory).catch(error => record('cleanup', 'failed', started, error.code))
      }
    }
  })()
  return { snapshot, work, cancel: () => controller.abort() }
}
