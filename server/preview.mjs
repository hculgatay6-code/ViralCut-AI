import { mkdtemp, readdir, rmdir, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExportError, inputOptions, probe, run } from './media.mjs'

const prefix = 'viralcut-preview-v6-'
const peakKey = 'lavfi.astats.Overall.Peak_level='

export async function prepareMedia(source, type, output, signal, progress) {
  const options = inputOptions(source.format)
  const info = await probe(source.path, source.format, signal)
  const duration = Number(info.format?.duration)
  if (!(duration > 0) || duration > 864000) throw new ExportError('badSource')
  const base = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', '-filter_threads', '1', ...options, '-i', source.path]
  if (type === 'waveform') {
    const step = Math.max(1, Math.ceil(duration / 7200))
    const peaks = []
    if (info.streams?.some(stream => stream.codec_type === 'audio')) {
      let frameTime = 0
      await run('ffmpeg', [...base, '-map', '0:a:0', '-vn', '-af',
        'aresample=8000:first_pts=0,asetnsamples=n=' + 8000 * step + ':p=0,' +
        'astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level,' +
        'ametadata=mode=print:key=' + peakKey.slice(0, -1) + ':file=-', '-f', 'null', '-'], signal, line => {
        const header = /pts_time:([-\d.]+)/.exec(line)
        if (header) frameTime = Math.max(0, Number(header[1]))
        else if (line.startsWith(peakKey) && peaks.length <= 7200) {
          const db = Number(line.slice(peakKey.length))
          peaks.push(Number.isFinite(db) ? Math.min(1, Math.pow(10, db / 40)) : 0)
          if (peaks.length % 30 === 0) progress(Math.min(99, frameTime / duration * 100))
        }
      })
    }
    return { step, peaks }
  }
  await run('ffmpeg', [...base, '-n', '-xerror', '-map', '0:V:0', '-map', '0:a:0?', '-map_metadata', '-1',
    '-vf', 'scale=w=min(iw\\,640):h=min(ih\\,480):force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,fps=24:start_time=0',
    '-c:v', 'libx264', '-threads:v', '2', '-preset', 'veryfast', '-crf', '25', '-g', '48', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-af', 'aresample=48000:first_pts=0', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-f', 'mp4', output], signal, line => {
    if (!line.startsWith('out_time_us=')) return
    const time = Number(line.slice(12))
    if (Number.isFinite(time)) progress(Math.min(99, Math.max(0, time / 10000 / duration)))
  })
  const verified = await probe(output, 'mp4', signal)
  const video = verified.streams?.find(stream => stream.codec_type === 'video')
  if (!video?.width || video.width > 640 || video.height > 480 || Math.abs(Number(verified.format?.duration) - duration) > .15) {
    throw new ExportError('verifyFailed')
  }
  return {}
}

async function cleanFolder(folder) {
  for (const file of await readdir(folder).catch(() => [])) {
    if (/^[a-f\d-]{36}\.mp4$/.test(file)) await unlink(join(folder, file)).catch(() => {})
  }
  await rmdir(folder).catch(() => {})
}

export function createPreviewQueue(resolveMedia, record = () => {}) {
  const tasks = new Map()
  const pending = []
  let active, work, folder
  let closed = false
  let paused = false
  const abandoned = (async () => {
    for (const entry of await readdir(tmpdir(), { withFileTypes: true })) {
      const match = /^viralcut-preview-v6-(\d+)-[a-z0-9]{6}$/i.exec(entry.name)
      if (!entry.isDirectory() || !match || Number(match[1]) <= 0) continue
      try { process.kill(Number(match[1]), 0) } catch (error) {
        if (error.code === 'ESRCH') await cleanFolder(join(tmpdir(), entry.name))
      }
    }
  })().catch(() => {})
  const view = ({ phase, progress, result, error }) => ({ phase, progress, ...result, error })

  function drain() {
    if (active || closed || paused || !pending.length) return
    const task = active = pending.shift()
    task.phase = 'running'
    const started = performance.now()
    work = (async () => {
      try {
        const signal = task.controller.signal
        signal.throwIfAborted()
        if (task.type === 'proxy') {
          await abandoned
          folder ??= await mkdtemp(join(tmpdir(), prefix + process.pid + '-'))
          task.path = join(folder, task.id + '.mp4')
        }
        const file = await stat(task.source.path)
        if (file.size !== task.source.size) throw new ExportError('missingProjectMedia')
        task.result = await prepareMedia(task.source, task.type, task.path, signal, value => { task.progress = value })
        signal.throwIfAborted()
        task.phase = 'ready'
        task.progress = 100
      } catch (error) {
        if (task.path) await unlink(task.path).catch(() => {})
        if (task.interrupted && !closed) {
          task.interrupted = false
          task.phase = 'queued'
          task.progress = 0
          task.controller = new AbortController()
          pending.unshift(task)
        } else {
          task.phase = task.controller.signal.aborted ? 'cancelled' : 'failed'
          if (task.phase === 'failed') task.error = error instanceof ExportError ? error.message : error.code
        }
      } finally {
        if (task.phase !== 'queued') record(task.type, task.phase, started, task.error)
        active = undefined
        drain()
      }
    })()
  }

  return {
    prioritize(value) {
      paused = value
      if (!value) { drain(); return }
      if (active && !active.controller.signal.aborted) {
        active.interrupted = true
        active.controller.abort()
      }
      return work
    },
    start(id, type) {
      const source = resolveMedia(id)
      if (closed || !source || !['proxy', 'waveform'].includes(type)) return { error: 'badMedia' }
      const key = type + id
      const old = tasks.get(key)
      if (old && !['failed', 'cancelled'].includes(old.phase)) return view(old)
      // Signals and cache entries are bounded for a session. Ready proxies stay readable until shutdown.
      if (pending.length >= 6 || (!old && tasks.size >= 100) || (type === 'proxy' &&
          [...tasks.values()].filter(task => task.type === 'proxy' && ['queued', 'running', 'ready'].includes(task.phase)).length >= 6)) return { error: 'queueFull' }
      const task = { id, type, source, phase: 'queued', progress: 0, controller: new AbortController() }
      tasks.set(key, task)
      pending.push(task)
      drain()
      return view(task)
    },
    status(id, type) {
      const task = tasks.get(type + id)
      return task ? view(task) : { phase: 'idle', progress: 0 }
    },
    cancel(id, type) {
      const task = tasks.get(type + id)
      if (task?.phase === 'queued') {
        pending.splice(pending.indexOf(task), 1)
        task.phase = 'cancelled'
      } else if (task?.phase === 'running') {
        task.interrupted = false
        task.controller.abort()
      }
      return task ? view(task) : { phase: 'idle', progress: 0 }
    },
    proxy(id) {
      const task = tasks.get('proxy' + id)
      return task?.phase === 'ready' ? task.path : undefined
    },
    async close() {
      closed = true
      pending.length = 0
      active?.controller.abort()
      await work
      if (folder) await cleanFolder(folder)
    },
  }
}
