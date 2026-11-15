import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, readdir, rename, rmdir, stat, statfs, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { checkTools, encodeClip, ExportError } from './media.mjs'
import { validateOverlay } from './ass.mjs'
import { transcribe, whisperAvailability } from './whisper.mjs'
import { instanceId } from './instance.mjs'
import { analyzeSilence, validateAnalysis, validateEdit, validateProfile } from './shorts.mjs'
import { encodeSequence, validateSequence } from './sequence.mjs'
import { analyzeShorts, batchSize, readShortsAnalysis, startShortsBatch } from './shorts-batch.mjs'
import { createSemanticService } from './semantic-service.mjs'
import { validateEffects } from './effects.mjs'
import { createVisualService } from './visual-service.mjs'
import { analysisKey } from './analysis-cache.mjs'

const idleLimit = 30 * 60 * 1000
const prefix = 'viralcut-export-v3-'
const tempFiles = ['input.mp4', 'input.webm', 'output.mp4', 'audio.wav', 'transcript.json', 'caption.ass', 'parts.txt',
  'edge-a.mkv', 'edge-b.mkv', 'edge-caption-a.ass', 'edge-caption-b.ass', 'studio-picture.mkv', 'studio-sequence.mkv']

async function removeWorkDir(directory) {
  const parts = (await readdir(directory)).filter(name => /^part-\d{1,4}\.mkv$/.test(name))
  for (const name of [...tempFiles, ...parts]) {
    await unlink(join(directory, name)).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
  }
  await rmdir(directory)
}

async function cleanAbandonedJobs() {
  for (const entry of await readdir(tmpdir(), { withFileTypes: true })) {
    const match = /^viralcut-export-v[23]-(\d+)-[a-z0-9]{6}$/i.exec(entry.name)
    if (!match || !entry.isDirectory() || Number(match[1]) <= 0) continue
    try {
      process.kill(Number(match[1]), 0)
    } catch (error) {
      if (error.code === 'ESRCH') await removeWorkDir(join(tmpdir(), entry.name)).catch(() => {})
    }
  }
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function readSettings(request, resolveMedia) {
  const contentLength = Number(request.headers['content-length'])
  if (request.headers['content-type'] !== 'application/json' ||
      !Number.isInteger(contentLength) || contentLength < 2 || contentLength > 8 * 1024 * 1024) {
    throw new ExportError('badRequest', 400)
  }
  let settings
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    settings = JSON.parse(Buffer.concat(chunks))
  } catch {
    throw new ExportError('badRequest', 400)
  }
  const { start, end, overlay, kind = 'export', language, device, mediaId } = settings ?? {}
  if (kind === 'sequence') {
    const sequence = validateSequence(settings, resolveMedia)
    const monitor = settings.monitor === true
    if (monitor && (sequence.parts.length !== 2 || sequence.parts.reduce((total, part) => total + part.end - part.start, 0) > 8.01 ||
        sequence.profile.resolution !== 720)) throw new ExportError('badEdit', 400)
    return { ...sequence, monitor }
  }
  const linked = mediaId === undefined ? undefined : resolveMedia?.(mediaId)
  if (mediaId !== undefined && !linked) throw new ExportError('missingProjectMedia', 422)
  const { format, size } = linked ?? settings ?? {}
  if (!['mp4', 'webm'].includes(format) || !Number.isSafeInteger(size) || size <= 0) {
    throw new ExportError('badRequest', 400)
  }
  if (kind === 'transcribe') {
    const voice = settings.voice === true
    if (!['auto', 'tr', 'en'].includes(language) || !['auto', 'cpu'].includes(device) ||
        (voice && (linked || format !== 'webm' || size > 4 * 1024 * 1024))) throw new ExportError('badRequest', 400)
    return { format, size, kind, language, device, linked, voice }
  }
  if (kind === 'silence') return { format, size, kind, linked, analysis: validateAnalysis(settings.analysis ?? {}), automatic: settings.automatic === true }
  if (kind === 'shorts-analysis' && linked) return { format, size, kind, linked, ...readShortsAnalysis(settings) }
  if (kind !== 'export') throw new ExportError('badRequest', 400)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start < 0.001) {
    throw new ExportError('badRange', 400)
  }
  let effects
  try { effects = validateEffects(settings.effects) } catch { throw new ExportError('badEdit', 400) }
  const monitor = settings.monitor === true
  if (monitor && (end - start > 8.001 || settings.profile?.resolution !== 720)) throw new ExportError('badEdit', 400)
  return { format, start, end, size, kind, linked, effects, monitor, overlay: overlay === undefined ? undefined : validateOverlay(overlay),
    edit: settings.edit === undefined ? undefined : validateEdit(settings.edit), profile: validateProfile(settings.profile) }
}

function errorCode(error, fallback) {
  if (error instanceof ExportError) return error.message
  if (error.code === 'ENOSPC') return 'diskFull'
  if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) return 'accessDenied'
  if (error.code === 'ENOENT') return 'toolsUnavailable'
  return fallback
}

export function createExportService({ desktop = false, resolveMedia, record = () => {}, onHeavyWork = () => {}, cache, budget, decode, onProviders, toolsReady } = {}) {
  const semantic = createSemanticService()
  const vision = createVisualService()
  let current
  let batch
  const batchActive = () => batch?.snapshot().active
  let creating = false
  let tools = toolsReady ?? checkTools()
  async function mediaReady() {
    if (!await tools) tools = checkTools()
    return tools
  }
  const abandoned = cleanAbandonedJobs().catch(() => {})
  let closed = false
  let cacheGeneration = 0, batchController, batchWork
  const trim = async () => { vision.clear(); await semantic.close() }
  const schedule = (label, signal, run, wait) => budget ? budget.work(label, signal, run, { wait, decode: decode?.(), trim }) : run()

  function snapshot(job) {
    return { id: job.id, phase: job.phase, stage: job.stage, progress: job.progress, error: job.error, encoder: job.encoder,
      verification: job.verification, cacheHit: job.cacheHit, waiting: job.waiting }
  }

  async function discard(job) {
    if (job.cleanup) return job.cleanup
    job.controller.abort()
    job.cleanup = (async () => {
      await Promise.allSettled([job.work, job.download, ...job.monitors])
      await removeWorkDir(job.directory).catch(error => {
        if (error.code !== 'ENOENT') record('cleanup', 'failed', job.started, error.code)
      })
      if (current === job) current = undefined
    })()
    return job.cleanup
  }

  const expiry = setInterval(() => {
    if (current && !current.download && Date.now() - current.touched > idleLimit) void discard(current)
  }, 15000)
  expiry.unref()

  function startEncoding(job) {
    job.phase = 'processing'
    job.progress = 0
    job.started = performance.now()
    const processJob = job.kind === 'shorts-analysis' ? analyzeShorts : job.kind === 'transcribe' ? transcribe : job.kind === 'silence' ? analyzeSilence
      : job.kind === 'sequence' ? encodeSequence : encodeClip
    const signal = job.controller.signal
    let heavy = false
    job.work = schedule(job.kind, signal, async () => {
      job.waiting = false
      job.controller.signal.throwIfAborted()
      if (job.linked) {
        const file = await stat(job.input).catch(() => null)
        if (!file?.isFile() || file.size !== job.linked.size) throw new ExportError('missingProjectMedia')
      }
      const generation = cacheGeneration
      const key = cache ? await analysisKey(job).catch(() => undefined) : undefined
      const cached = key && await cache.read(key).catch(() => undefined)
      signal.throwIfAborted()
      if (cached && generation === cacheGeneration) { job.cacheHit = true; return cached }
      heavy = true
      await onHeavyWork(true)
      const result = await processJob({
        input: job.input, output: job.output, format: job.format, start: job.start, end: job.end, voice: job.voice,
        directory: job.directory, language: job.language, device: job.device, overlay: job.overlay,
        analysis: job.analysis, edit: job.edit, effects: job.effects,
        semantic, vision, goal: job.goal, duration: job.duration, visualMode: job.visualMode, visualDevice: job.visualDevice, director: job.director,
        parts: job.parts, frame: job.frame, profile: job.profile, encoder: job.encoder, mastering: job.mastering,
        signal: job.controller.signal,
        onStage: stage => { job.stage = stage },
        onProgress: progress => { job.progress = Math.max(job.progress, progress) },
      })
      if (job.kind === 'shorts-analysis' && result.visual) onProviders?.(result.visual.models)
      if (key && !signal.aborted && !result.speechUnavailable && ['e5', 'visual'].includes(result.selection?.mode) &&
          result.visual?.models.every(model => ['cpu', 'dml'].includes(model)) &&
          key === await analysisKey(job).catch(() => undefined)) {
        await cache.write(key, result, () => generation === cacheGeneration && !signal.aborted).catch(() => {})
      }
      return result
    }, () => { job.waiting = true }).then(result => {
      if (job.kind === 'transcribe' || job.kind === 'shorts-analysis') job.transcript = result
      else if (job.kind === 'silence') job.silence = result
      else {
        job.outputSize = result.size
        job.encoder = result.encoder
        job.verification = result.verification
      }
      job.phase = 'ready'
      job.progress = 100
    }).catch(error => {
      if (job.controller.signal.aborted) return
      job.phase = 'failed'
      job.error = errorCode(error, 'encodeFailed')
    }).finally(async () => {
      if (heavy) onHeavyWork(false)
      record(job.kind, job.controller.signal.aborted ? 'cancelled' : job.phase, job.started, job.error)
      if (!job.linked) await unlink(job.input).catch(() => {})
      for (const name of ['audio.wav', 'transcript.json', 'caption.ass']) await unlink(join(job.directory, name)).catch(() => {})
      const parts = await readdir(job.directory).catch(() => [])
      for (const name of parts.filter(name => name === 'parts.txt' || /^part-\d{1,4}\.mkv$/.test(name))) {
        await unlink(join(job.directory, name)).catch(() => {})
      }
      if (job.phase !== 'ready') await unlink(job.output).catch(() => {})
      job.touched = Date.now()
    })
  }

  async function handle(request, response, address) {
    if (closed) throw new ExportError('serviceError', 503)
    const route = /^\/api\/export(?:\/(health|whisper|([a-f0-9-]{36})(?:\/(input|file|download|transcript|silence|monitor))?))?$/.exec(request.url ?? '')
    if (!route) throw new ExportError('badRequest', 404)
    const authority = request.headers.host?.toLowerCase()
    const hosts = desktop ? ['127.0.0.1:'] : ['127.0.0.1:', 'localhost:', '[::1]:']
    const localAuthority = address && hosts.some(host => authority === host + address.port)
    const sameOrigin = 'http://' + authority
    const origin = request.headers.origin
    const fetchSite = request.headers['sec-fetch-site']
    const [ , subpath, id, resource ] = route
    const { method } = request
    const browserDownload = method === 'GET' && fetchSite === 'same-origin' && (resource === 'download' || (desktop && resource === 'monitor'))
    if (!localAuthority ||
        (origin && origin !== sameOrigin) || (fetchSite && fetchSite !== 'same-origin') ||
        (!browserDownload && request.headers['x-viralcut'] !== '2')) {
      throw new ExportError('forbidden', 403)
    }

    if (method === 'GET' && subpath === 'health') {
      const [ffmpeg, whisper] = await Promise.all([checkTools({ subtitles: true }), whisperAvailability({ verify: true })])
      return json(response, 200, { instanceId, ffmpeg, whisper })
    }
    if (method === 'GET' && subpath === 'whisper') {
      const [status, mediaAvailable] = await Promise.all([whisperAvailability(), mediaReady()])
      return json(response, 200, { ...status, mediaAvailable, available: status.available && mediaAvailable })
    }
    if (method === 'GET' && !subpath) return json(response, 200, { available: await mediaReady() })
    if (method === 'POST' && !subpath) {
      if (creating || batchActive() || (current && !current.automatic && !(current.monitor && current.phase === 'ready'))) throw new ExportError('busy', 409)
      creating = true
      try {
        if (!await mediaReady()) throw new ExportError('toolsUnavailable', 503)
        const settings = await readSettings(request, resolveMedia)
        if (current && !settings.automatic) await discard(current)
        if (current) throw new ExportError('busy', 409)
        if (settings.kind === 'transcribe' && !(await whisperAvailability()).available) throw new ExportError('whisperUnavailable', 503)
        await abandoned
        const { bsize, bavail } = await statfs(tmpdir(), { bigint: true })
        if (!settings.linked && settings.size && BigInt(settings.size) >= bsize * bavail) throw new ExportError('diskFull', 507)
        const directory = await mkdtemp(join(tmpdir(), prefix + process.pid + '-'))
        if (closed) {
          await removeWorkDir(directory)
          throw new ExportError('serviceError', 503)
        }
        current = {
          ...settings, directory, id: randomUUID(), phase: 'waiting', progress: 0, touched: Date.now(),
          input: settings.linked?.path ?? join(directory, 'input.' + settings.format), output: join(directory, 'output.mp4'),
          controller: new AbortController(), monitors: new Set(),
        }
        if (settings.kind === 'sequence' || settings.linked) startEncoding(current)
        return json(response, 201, snapshot(current))
      } finally {
        creating = false
      }
    }

    const job = current
    if (!job || job.id !== id) throw new ExportError('jobMissing', 404)
    if (method === 'DELETE' && !resource) {
      await discard(job)
      return json(response, 200, { cancelled: true })
    }
    if (job.cleanup) throw new ExportError('jobMissing', 404)
    job.touched = Date.now()
    if (method === 'GET' && !resource) return json(response, 200, snapshot(job))
    if (method === 'GET' && resource === 'transcript' && job.phase === 'ready' && ['transcribe', 'shorts-analysis'].includes(job.kind)) {
      return json(response, 200, job.transcript)
    }
    if (method === 'GET' && resource === 'silence' && job.phase === 'ready' && job.kind === 'silence') return json(response, 200, job.silence)
    if (method === 'GET' && resource === 'monitor' && desktop && job.monitor && job.phase === 'ready') {
      const header = request.headers.range
      const match = header && /^bytes=(\d+)-(\d*)$/.exec(header)
      const start = match ? Number(match[1]) : 0
      const end = match?.[2] ? Math.min(Number(match[2]), job.outputSize - 1) : job.outputSize - 1
      if ((header && !match) || !Number.isSafeInteger(start) || start > end) {
        return response.writeHead(416, { 'Content-Range': 'bytes */' + job.outputSize }).end()
      }
      response.writeHead(match ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        ...(match ? { 'Content-Range': `bytes ${start}-${end}/${job.outputSize}` } : {}) })
      const stream = pipeline(createReadStream(job.output, { start, end }), response, { signal: job.controller.signal })
      job.monitors.add(stream)
      try { await stream } catch { /* Preview can close or seek during playback. */ }
      finally { job.monitors.delete(stream) }
      return
    }

    if (method === 'PUT' && resource === 'input') {
      if (job.phase !== 'waiting') throw new ExportError('busy', 409)
      if (request.headers['content-type'] !== 'application/octet-stream' ||
          Number(request.headers['content-length']) !== job.size) throw new ExportError('badRequest', 400)
      job.phase = 'receiving'
      let received = 0
      const meter = new Transform({
        transform(chunk, _encoding, done) {
          received += chunk.length
          job.touched = Date.now()
          job.progress = Math.min(100, received / job.size * 100)
          done(null, chunk)
        },
      })
      job.work = pipeline(request, meter, createWriteStream(job.input, { flags: 'wx', mode: 0o600 }), {
        signal: job.controller.signal,
      })
      try {
        await job.work
        job.controller.signal.throwIfAborted()
        if (received !== job.size) throw new ExportError('uploadFailed')
        startEncoding(job)
        return json(response, 202, snapshot(job))
      } catch (error) {
        if (job.controller.signal.aborted) return
        job.phase = 'failed'
        job.error = errorCode(error, 'uploadFailed')
        await unlink(job.input).catch(() => {})
        if (!response.destroyed) json(response, 422, snapshot(job))
        return
      }
    }
    if (method === 'GET' && (resource === 'file' || resource === 'download') && job.phase === 'ready' && ['export', 'sequence'].includes(job.kind)) {
      if (job.download) throw new ExportError('busy', 409)
      response.writeHead(200, {
        'Content-Type': 'video/mp4', 'Content-Length': job.outputSize, 'Content-Disposition': 'attachment',
      })
      job.download = pipeline(createReadStream(job.output), response, { signal: job.controller.signal })
      try {
        await job.download
        if (resource === 'download') await discard(job)
      } catch {
        // The browser can cancel and retry a save without re-encoding.
      } finally {
        job.download = undefined
        job.touched = Date.now()
      }
      return
    }
    throw new ExportError('badRequest', 409)
  }

  return {
    async clearCache() {
      if (creating || batchActive() || current?.phase === 'processing') return false
      cacheGeneration++; await trim(); await cache?.clear()
      return true
    },
    activity() { return { job: current && ['waiting', 'receiving', 'processing'].includes(current.phase) ? snapshot(current) : undefined,
      batch: this.batchStatus(), operation: current?.kind } },
    async startBatch(request, directory, retry = false, music) {
      if (!desktop || closed || !batchSize(request)) throw new ExportError('badEdit', 400)
      if (creating || batchActive() || (current && !current.automatic && !(current.monitor && current.phase === 'ready'))) throw new ExportError('busy', 409)
      creating = true
      try {
        const source = resolveMedia?.(request.mediaId)
        if (!source) throw new ExportError('missingProjectMedia')
        if (!await mediaReady()) throw new ExportError('toolsUnavailable', 503)
        if (current) await discard(current)
        await batch?.work
        if (closed) throw new ExportError('serviceError', 503)
        const controller = new AbortController()
        batchController = controller
        const id = randomUUID()
        let running, pending = true, failed = false, heavy = false
        const snapshot = () => running ? { ...running.snapshot(), id } : { id, active: pending, waiting: pending,
          items: request.items.map(() => ({ phase: pending ? 'queued' : failed ? 'failed' : 'cancelled', progress: 0,
            ...(failed ? { error: 'serviceError' } : {}) })) }
        batchWork = schedule('batch', controller.signal, async () => {
          heavy = true
          await onHeavyWork(true)
          controller.signal.throwIfAborted()
          running = startShortsBatch(request, source, directory, removeWorkDir, prefix, record, retry, music)
          await running.work
        }).catch(() => { failed = !controller.signal.aborted }).finally(() => {
          pending = false
          if (heavy) onHeavyWork(false)
        })
        batch = { snapshot, work: batchWork, cancel() { controller.abort(); running?.cancel() } }
        return snapshot()
      } finally { creating = false }
    },
    batchStatus() { return batch?.snapshot() ?? { active: false, items: [] } },
    cancelBatch() { batch?.cancel(); return this.batchStatus() },
    hasExport(id) {
      return current?.id === id && ['export', 'sequence'].includes(current.kind) && current.phase === 'ready' && !current.cleanup && !current.download
    },
    async saveExport(id, path) {
      if (!this.hasExport(id)) throw new ExportError('jobMissing', 404)
      const job = current
      job.touched = Date.now()
      job.download = (async () => {
        const temp = join(dirname(path), '.viralcut-' + randomUUID() + '.tmp')
        try {
          await pipeline(createReadStream(job.output), createWriteStream(temp, { flags: 'wx', mode: 0o600 }), {
            signal: job.controller.signal,
          })
          job.controller.signal.throwIfAborted()
          await rename(temp, path)
        } finally {
          await unlink(temp).catch(() => {})
        }
      })()
      try { await job.download } finally { job.download = undefined }
    },
    middleware(request, response, next, address) {
      if (!request.url?.startsWith('/api/export')) return next()
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
      response.setHeader('X-Content-Type-Options', 'nosniff')
      void handle(request, response, address).catch(error => {
        if (!response.headersSent && !response.destroyed) {
          json(response, error.status ?? 500, { error: errorCode(error, 'serviceError') })
        }
      })
    },
    async close() {
      closed = true
      clearInterval(expiry)
      batchController?.abort()
      batch?.cancel()
      await batch?.work
      if (current) await discard(current)
      await semantic.close()
    },
  }
}
