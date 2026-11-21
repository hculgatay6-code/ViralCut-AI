import { unlink } from 'node:fs/promises'
import { ExportError, inputOptions, probe, run } from './media.mjs'
import { createProxyCache, mediaIdentity, proxyKey, proxyProfiles, proxyRates } from './proxy-cache.mjs'
import { fastDecode, ffmpegThreads } from './resource-budget.mjs'

const peakKey = 'lavfi.astats.Overall.Peak_level='

export async function prepareMedia(source, type, output, signal, progress, { height = 360, nvenc = false, info } = {}) {
  const options = inputOptions(source.format)
  info ??= await probe(source.path, source.format, signal)
  const duration = Number(info.format?.duration)
  if (!(duration > 0) || duration > 864000) throw new ExportError('badSource')
  const command = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', ffmpegThreads(4), '-filter_threads', '1']
  const base = [...command, ...options, '-i', source.path]
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
  if (!proxyProfiles.includes(height)) throw new ExportError('badMedia')
  const original = info.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
  if (!original?.width || !original.height) throw new ExportError('badSource')
  // An SDR proxy cannot faithfully represent an HDR master.
  if (['smpte2084', 'arib-std-b67'].includes(original.color_transfer)) throw new ExportError('proxyHdr')
  const hasAudio = info.streams.some(stream => stream.codec_type === 'audio')
  const long = Math.round(height * 16 / 18) * 2
  const scale = "scale=w='min(iw*sar,if(gte(dar,1)," + long + ',' + height + "))':h='min(ih,if(gte(dar,1)," +
    height + ',' + long + "))':force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1"
  const rate = proxyRates[height]
  const hw = nvenc && Math.max(original.width, original.height) >= 1920 &&
    ['h264', 'hevc'].includes(original.codec_name) ? fastDecode() : undefined
  async function encode(gpu, decode) {
    const codec = gpu ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '24', '-b:v', '0']
      : ['-c:v', 'libx264', '-threads:v', ffmpegThreads(4), '-preset', 'veryfast', '-crf', '24']
    await run('ffmpeg', [...command, ...(decode ? ['-hwaccel', decode] : []), ...options, '-i', source.path,
      '-n', '-xerror', '-map', '0:V:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1',
      '-vf', scale, ...codec, '-maxrate', rate + 'k', '-bufsize', rate * 2 + 'k', '-g', '30',
      '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-enc_time_base:v', 'demux',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      '-progress', 'pipe:1', '-f', 'mp4', output], signal, line => {
      if (!line.startsWith('out_time_us=')) return
      const time = Number(line.slice(12))
      if (Number.isFinite(time)) progress(Math.min(99, Math.max(0, time / 10000 / duration)))
    })
  }
  let gpu = nvenc
  let decoder = hw
  try { await encode(gpu, decoder) }
  catch (error) {
    signal.throwIfAborted()
    if (!gpu || error.message !== 'encodeFailed') throw error
    await unlink(output).catch(err => { if (err.code !== 'ENOENT') throw err })
    gpu = false
    decoder = undefined
    await encode(false)
  }
  const verified = await probe(output, 'mp4', signal)
  const video = verified.streams?.find(stream => stream.codec_type === 'video')
  const audio = verified.streams?.some(stream => stream.codec_type === 'audio')
  if (video?.codec_name !== 'h264' || Math.min(video.width, video.height) > height || Math.max(video.width, video.height) > long ||
      hasAudio !== audio || !Number.isFinite(Number(verified.format?.duration)) || Math.abs(Number(verified.format.duration) - duration) > .15) {
    throw new ExportError('verifyFailed')
  }
  return { width: video.width, height: video.height, encoder: gpu ? 'NVENC' : 'CPU', decoder: decoder ?? 'cpu' }
}

export function createPreviewQueue(resolveMedia, record = () => {}, { directory, budget, hardware, limits } = {}) {
  const cache = createProxyCache(directory, limits)
  const tasks = new Map()
  const pending = []
  let active, work
  let closed = false
  let paused = false
  const view = ({ phase, progress, result, error, height, type }) => ({ phase, progress, resolution: type === 'proxy' ? height : undefined, ...result, error })
  const taskKey = (id, type, height) => type + id + (type === 'proxy' ? height : '')

  async function available(id, height, touch = false) {
    const source = resolveMedia(id)
    if (!source || !proxyProfiles.includes(height)) return
    try { return await cache.lookup(proxyKey(await mediaIdentity(source), height), touch) }
    catch { return }
  }

  function interrupt() {
    if (active && !active.controller.signal.aborted) {
      active.interrupted = true
      active.controller.abort()
    }
  }

  function drain() {
    if (active || closed || paused || !pending.length) return
    const task = active = pending.shift()
    task.phase = 'running'
    const started = performance.now()
    work = (async () => {
      try {
        const signal = task.controller.signal
        signal.throwIfAborted()
        const processMedia = async () => {
          const update = value => { task.progress = Math.max(task.progress, value) }
          const identity = await mediaIdentity(task.source)
          if (task.type === 'waveform') return prepareMedia(task.source, task.type, undefined, signal, update)
          const key = proxyKey(identity, task.height)
          const reused = await cache.lookup(key, true)
          if (reused) {
            task.path = reused.path
            return { cached: true }
          }
          const info = await probe(task.source.path, task.source.format, signal)
          const duration = Number(info.format?.duration)
          if (!(duration > 0) || duration > 864000) throw new ExportError('badSource')
          const bytes = Math.ceil((proxyRates[task.height] + 160) * 125 * duration) + 1024 ** 2
          task.temp = await cache.prepare(bytes)
          const result = await prepareMedia(task.source, task.type, task.temp, signal, update,
            { height: task.height, nvenc: task.device === 'auto' && !!hardware?.()?.nvenc, info })
          signal.throwIfAborted()
          const linked = resolveMedia(task.id)
          if (!linked || key !== proxyKey(await mediaIdentity(linked), task.height)) throw new ExportError('missingProjectMedia')
          await cache.publish(task.temp, key)
          task.path = (await cache.lookup(key))?.path
          return result
        }
        const result = budget ? await budget.work(task.type, signal, () => {
          task.phase = 'running'
          return processMedia()
        }, { background: true, interrupt, wait: () => { task.phase = 'queued' }, decode: hardware?.()?.decode }) : await processMedia()
        signal.throwIfAborted()
        task.result = result
        task.phase = 'ready'
        task.progress = 100
      } catch (error) {
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
        if (task.temp) {
          await unlink(task.temp).catch(() => {})
          task.temp = undefined
        }
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
      interrupt()
      return work
    },
    start(id, type, height = 360, device = 'auto') {
      const source = resolveMedia(id)
      if (closed || !source || !['proxy', 'waveform'].includes(type) || !proxyProfiles.includes(height) ||
          !['auto', 'cpu'].includes(device) || (type === 'proxy' && !['mp4', 'webm'].includes(source.format))) return { error: 'badMedia' }
      const key = taskKey(id, type, height)
      const old = tasks.get(key)
      if (old && (old === active || pending.includes(old) || type === 'waveform' && old.phase === 'ready')) return view(old)
      if (pending.length >= 6) return { error: 'queueFull' }
      if (!old && tasks.size >= 400) {
        const expired = [...tasks].find(([, task]) => task !== active && !pending.includes(task))
        if (expired) tasks.delete(expired[0])
      }
      const task = { id, type, height, device, source, phase: 'queued', progress: 0, controller: new AbortController() }
      tasks.set(key, task)
      pending.push(task)
      drain()
      return view(task)
    },
    status(id, type, height = 360) {
      const task = tasks.get(taskKey(id, type, height))
      return task ? view(task) : { phase: 'idle', progress: 0 }
    },
    async cacheStatus(id, height) {
      const task = this.status(id, 'proxy', height)
      if (!['queued', 'running'].includes(task.phase) && await available(id, height)) {
        return task.phase === 'ready' ? task : { phase: 'ready', progress: 100, resolution: height, cached: true }
      }
      return task.phase === 'ready' ? { phase: 'idle', progress: 0 } : task
    },
    cancel(id, type, height = 360) {
      const task = tasks.get(taskKey(id, type, height))
      if (task === active && task) {
        task.interrupted = false
        task.controller.abort()
      } else if (task?.phase === 'queued') {
        pending.splice(pending.indexOf(task), 1)
        task.phase = 'cancelled'
      }
      return task ? view(task) : { phase: 'idle', progress: 0 }
    },
    proxy(id, height = 360) {
      const task = tasks.get(taskKey(id, 'proxy', height))
      return task?.phase === 'ready' ? task.path : undefined
    },
    playable: available,
    async info() {
      return { ...await cache.info(), active: active ? view(active) : undefined, waiting: pending.length }
    },
    async clear() {
      if (active || pending.length) return false
      await cache.clear()
      return true
    },
    async close() {
      closed = true
      pending.length = 0
      active?.controller.abort()
      await work
      await cache.close()
    },
  }
}
