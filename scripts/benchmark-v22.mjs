import { execFileSync, spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { cpus, freemem, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const [repository, dataDirectory] = process.argv.slice(2)
if (!repository || !dataDirectory) throw Error('Usage: node scripts/benchmark-v22.mjs REPO DATA_DIRECTORY')
const root = resolve(repository)
const directory = resolve(dataDirectory)
const load = path => import(pathToFileURL(join(root, path)).href)
const { createExportService } = await load('server/export.mjs')
const { createPreviewQueue } = await load('server/preview.mjs')
const { createProjectStore } = await load('desktop/projects.mjs')
const { emptyTrack, mediaClip } = await load('src/project/layer-model.ts')
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
const run = (...args) => execFileSync(process.env.VIRALCUT_FFMPEG ?? 'ffmpeg', ['-v', 'error', '-nostdin', ...args],
  { windowsHide: true, timeout: 180000, maxBuffer: 2 ** 20 })
await mkdir(directory, { recursive: true })
const store = createProjectStore(join(directory, 'unused.viralcut'))
const previews = createPreviewQueue(store.resolveMedia, undefined, { directory: join(directory, 'proxy-' + version) })
const service = createExportService({ desktop: true, resolveMedia: store.resolveMedia, resolveProxy: previews.playable })
const server = createServer((req, res) => service.middleware(req, res, () => res.writeHead(404).end(), server.address()))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = 'http://127.0.0.1:' + server.address().port + '/api/export'

async function fixture(width, height, duration) {
  const base = 'pattern-' + height + '.mp4'
  if (!(await stat(join(directory, base)).catch(() => null))) {
    run('-f', 'lavfi', '-i', 'testsrc2=s=' + width + 'x' + height + ':r=30',
      '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '10', '-threads:v', '4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', join(directory, base))
  }
  const target = join(directory, height + '-' + duration + '.mp4')
  if (!(await stat(target).catch(() => null))) {
    const manifest = join(directory, 'fixture.txt')
    await writeFile(manifest, ('file ' + base + '\nduration 10\n').repeat(duration / 10))
    run('-f', 'concat', '-safe', '1', '-i', manifest, '-map', '0', '-c', 'copy', '-t', String(duration), target)
  }
  return store.register(target)
}

async function request(path = '', method = 'GET', body) {
  const response = await fetch(url + path, { method, signal: AbortSignal.timeout(60000),
    headers: { 'x-viralcut': '2', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body && JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw Error(result.error)
  return result
}

const gpu = spawn('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,utilization.encoder,utilization.decoder',
  '--format=csv,noheader,nounits', '--loop-ms=200'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
let readings = [], pending = ''
gpu.on('error', () => {})
gpu.stdout.setEncoding('utf8').on('data', data => {
  const lines = (pending + data).split('\n')
  pending = lines.pop()
  for (const line of lines) {
    const values = line.trim().split(',').map(Number)
    if (values.length === 4 && values.every(Number.isFinite)) readings.push(values)
  }
})
function cpu() {
  return cpus().reduce(([idle, ticks], { times }) =>
    [idle + times.idle, ticks + Object.values(times).reduce((sum, time) => sum + time, 0)], [0, 0])
}
async function sample(name, task) {
  readings = []
  const before = cpu()
  const start = performance.now()
  let peakUsed = totalmem() - freemem(), peakNode = process.memoryUsage().rss
  const timer = setInterval(() => {
    peakUsed = Math.max(peakUsed, totalmem() - freemem())
    peakNode = Math.max(peakNode, process.memoryUsage().rss)
  }, 100)
  try {
    const result = await task()
    const after = cpu()
    const mib = bytes => Math.round(bytes / 1024 ** 2)
    const peak = index => readings.length ? Math.max(...readings.map(row => row[index])) : null
    console.log(JSON.stringify({ version, name, ms: Math.round(performance.now() - start),
      systemCPU: Math.round(100 * (1 - (after[0] - before[0]) / Math.max(1, after[1] - before[1]))),
      systemRAMMiB: mib(peakUsed), nodeRAMMiB: mib(peakNode),
      peakGPU: peak(0), peakVRAMMiB: peak(1), peakEncode: peak(2), peakDecode: peak(3), ...result }))
  } finally { clearInterval(timer) }
}

async function encode(settings, preview) {
  const { id } = await request('', 'POST', { ...settings, preview })
  try {
    const timeout = AbortSignal.timeout(180000)
    for (;;) {
      const job = await request('/' + id)
      if (job.phase === 'failed') throw Error(job.error)
      if (job.phase === 'ready') return { encoder: job.encoder, cacheHit: !!job.cacheHit,
        proxyCount: job.proxyCount, ...job.verification }
      await delay(40, undefined, { signal: timeout })
    }
  } finally { await request('/' + id, 'DELETE') }
}

try {
  for (const [width, height, duration] of [[1920, 1080, 300], [1920, 1080, 1800], [3840, 2160, 300]]) {
    const source = await fixture(width, height, duration)
    const at = (duration - 20) * 30
    const stack = ['blur', 'glow', 'grain', 'vignette', 'mono'].map(id =>
      ({ id, enabled: true, start: 0, end: 360, detail: .4, amount: .3 }))
    const tracks = [
      { ...emptyTrack('video', 'V1'), clips: [mediaClip(source.id, 'video', 0, at, 360)] },
      { ...emptyTrack('video', 'V2'), clips: [{ ...mediaClip(source.id, 'video', 0, at, 360), scale: .37, x: .8, y: .1, effects: stack }] },
      { ...emptyTrack('audio', 'A1'), clips: [mediaClip(source.id, 'audio', 0, at, 360)] },
    ]
    const settings = { kind: 'sequence', timeline: { fps: 30, tracks }, encoder: 'auto',
      profile: { resolution: 720, fps: 30, quality: 'balanced', bitrate: 0 } }
    const name = height + 'p/' + duration / 60 + 'm'
    const window = { from: 30, to: 270 }
    await sample(name + '/cold', () => encode(settings, window))
    await sample(name + '/seek-away', () => encode(settings, { from: 240, to: 360 }))
    await sample(name + '/return', () => encode(settings, window))
    if (height === 1080 && duration === 300) {
      await sample(name + '/original-mp4', () => encode(settings))
      const begin = previews.cacheStatus ? { height: 360 } : {}
      await sample(name + '/proxy', async () => {
        previews.start(source.id, 'proxy', begin.height)
        const timeout = AbortSignal.timeout(300000)
        for (;;) {
          const status = previews.status(source.id, 'proxy', begin.height)
          if (status.phase === 'failed') throw Error(status.error)
          if (status.phase === 'ready') return { encoder: status.encoder ?? 'CPU' }
          await delay(100, undefined, { signal: timeout })
        }
      })
      if (previews.playable) await sample(name + '/proxy-preview', () => encode(settings, { ...window, proxy: 360 }))
    }
  }
} finally {
  gpu.kill()
  await Promise.allSettled([previews.close(), service.close(), new Promise(resolve => server.close(resolve))])
}
