import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { lstat, mkdtemp, readdir, rm, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createProjectStore } from '../desktop/projects.mjs'
import { createExportService } from '../server/export.mjs'
import { mediaIdentity } from '../server/proxy-cache.mjs'
import { probe } from '../server/media.mjs'
import { createPreviewQueue } from '../server/preview.mjs'
import { createResourceBudget } from '../server/resource-budget.mjs'
import { emptyTrack, mediaClip } from '../src/project/layer-model.ts'
import { defaultProfile, historyReducer } from '../src/project/model.ts'
import { appendApprovedShorts, speechCutInside } from '../src/editor/approved-shorts.ts'
import { defaultAppearance } from '../src/subtitles/model.ts'

let directory, store, source, silent, settings
const ff = (...args) => execFileSync(process.env.VIRALCUT_FFMPEG ?? 'ffmpeg',
  ['-v', 'error', '-nostdin', ...args], { windowsHide: true, timeout: 30000, maxBuffer: 2 ** 20 })

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'viralcut-v22-test-'))
  store = createProjectStore(join(directory, 'recovery.viralcut'))
  const target = join(directory, 'landscape.mp4')
  ff('-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30', '-f', 'lavfi', '-i', 'sine=frequency=713:sample_rate=48000',
    '-af', 'adelay=700:all=1', '-t', '3', '-threads:v', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', target)
  source = await store.register(target)
  const portrait = join(directory, 'silent.mp4')
  ff('-f', 'lavfi', '-i', 'testsrc2=s=540x960:r=25', '-t', '2',
    '-threads:v', '2', '-c:v', 'libx264', '-preset', 'ultrafast', portrait)
  silent = await store.register(portrait)
  const tracks = [emptyTrack('video', 'V1'), emptyTrack('video', 'V2'), emptyTrack('audio', 'A1'), emptyTrack('caption', 'CC1')]
  tracks[0].clips = [mediaClip(source.id, 'video', 0, 0, 90)]
  tracks[1].clips = [{ ...mediaClip(source.id, 'video', 0, 0, 45), scale: .48 },
    { ...mediaClip(source.id, 'video', 45, 45, 45), scale: .27, x: 1, y: 0,
      effects: [{ id: 'mono', enabled: true, start: 0, end: 45, detail: .5, amount: .8 }],
      incoming: { id: 'dissolve', length: 12, start: 0, amount: 1, direction: 'left' } }]
  tracks[2].clips = [mediaClip(source.id, 'audio', 0, 0, 90)]
  tracks[3].clips = [{ id: crypto.randomUUID(), at: 44, length: 19, text: 'Görüntü ve ses' }]
  settings = { kind: 'sequence', timeline: { fps: 30, tracks }, encoder: 'cpu', appearance: defaultAppearance,
    profile: { ...defaultProfile, resolution: 720 } }
})
after(() => directory && rm(directory, { recursive: true, force: true, maxRetries: 5 }))

async function until(get, pending = value => ['queued', 'running', 'waiting', 'processing'].includes(value.phase)) {
  const signal = AbortSignal.timeout(45000)
  for (;;) {
    signal.throwIfAborted()
    const state = await get()
    if (!pending(state)) return state
    await delay(35, undefined, { signal })
  }
}

async function render(service, t) {
  const server = createServer((req, res) => service.middleware(req, res, () => res.writeHead(404).end(), server.address()))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await service.close()
    await new Promise(resolve => server.close(resolve))
  })
  return (path = '', method = 'GET', body) => fetch('http://127.0.0.1:' + server.address().port + '/api/export' + path,
    { method, headers: { 'x-viralcut': '2', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body && JSON.stringify(body), signal: AbortSignal.timeout(45000) })
}

test('three CPU profiles keep source frames and audio, remain available on restart, and invalidate on change', async t => {
  const cache = join(directory, 'proxy-profiles')
  const makeQueue = () => createPreviewQueue(store.resolveMedia, undefined, { directory: cache })
  const queue = makeQueue()
  t.after(() => queue.close())
  const original = await mediaIdentity(store.resolveMedia(source.id))
  for (const [height, width] of [[360, 640], [540, 960], [720, 1280]]) {
    queue.start(source.id, 'proxy', height, 'cpu')
    const state = await until(() => queue.status(source.id, 'proxy', height))
    assert.equal(state.phase, 'ready', state.error)
    assert.deepEqual([state.width, state.height, state.encoder], [width, height, 'CPU'])
    const { path } = await queue.playable(source.id, height)
    const info = await probe(path, 'mp4', AbortSignal.timeout(3000))
    const video = info.streams.find(stream => stream.codec_type === 'video')
    assert.equal(video.avg_frame_rate, '30/1')
    assert.equal(Number(video.nb_frames), 90)
    assert.ok(info.streams.some(stream => stream.codec_type === 'audio'))
    const audio = file => ff('-ss', '0.50', '-i', file, '-map', '0:a:0', '-t', '0.5', '-c:a', 'pcm_s16le', '-f', 's16le', '-')
    const onset = bytes => {
      for (let offset = 0; offset + 1 < bytes.length; offset += 2) if (Math.abs(bytes.readInt16LE(offset)) > 120) return offset / 2
      return -1
    }
    const a = onset(audio(original[0])), b = onset(audio(path))
    assert.ok(a > 0 && b > 0 && Math.abs(a - b) < 480, 'Audio onset must agree within 10 ms')
  }
  queue.start(silent.id, 'proxy', 360, 'cpu')
  const vertical = await until(() => queue.status(silent.id, 'proxy'))
  assert.deepEqual([vertical.width, vertical.height], [360, 640])
  await queue.close()
  const reopened = makeQueue()
  t.after(() => reopened.close())
  const state = await reopened.cacheStatus(source.id, 540)
  assert.ok(state.cached)
  assert.deepEqual(await mediaIdentity(store.resolveMedia(source.id)), original)
  const link = store.resolveMedia(source.id)
  const file = await lstat(link.path)
  await utimes(link.path, file.atime, new Date(file.mtimeMs - 5000))
  assert.equal(await reopened.playable(source.id, 540), undefined)
  assert.equal((await reopened.cacheStatus(source.id, 540)).phase, 'idle')
})

test('proxy generation yields to foreground work, then completes after cancellation and retry', async t => {
  const cache = join(directory, 'proxy-queue')
  const budget = createResourceBudget({ free: () => 4 * 1024 ** 3, total: () => 8 * 1024 ** 3, poll: 15 })
  const queue = createPreviewQueue(store.resolveMedia, undefined, { directory: cache, budget })
  t.after(() => queue.close())
  queue.start(source.id, 'proxy', 540, 'cpu')
  await budget.work('export', AbortSignal.timeout(5000), () => assert.equal(budget.info().active, 'export'))
  queue.cancel(source.id, 'proxy', 540)
  assert.equal((await until(() => queue.status(source.id, 'proxy', 540))).phase, 'cancelled')
  assert.ok(!(await readdir(cache)).some(name => name.endsWith('.part')))
  queue.start(source.id, 'proxy', 540, 'cpu')
  assert.equal((await until(() => queue.status(source.id, 'proxy', 540))).phase, 'ready')
  assert.equal((await queue.info()).entries, 1)
})

test('disk reserve prevents partial proxy writes; hardware failure retries with real CPU encoding', async t => {
  const cache = join(directory, 'proxy-disk')
  const blocked = createPreviewQueue(store.resolveMedia, undefined, { directory: cache, limits: { reserve: Number.MAX_SAFE_INTEGER } })
  t.after(() => blocked.close())
  blocked.start(source.id, 'proxy')
  assert.equal((await until(() => blocked.status(source.id, 'proxy'))).error, 'diskFull')
  assert.deepEqual(await readdir(cache), [])
  const budget = createResourceBudget({ free: () => 5 * 1024 ** 3, total: () => 8 * 1024 ** 3, poll: 10 })
  budget.change('performance')
  const queue = createPreviewQueue(store.resolveMedia, undefined, { directory: cache, budget,
    hardware: () => ({ nvenc: true, decode: 'unavailable-test-device' }) })
  t.after(() => queue.close())
  queue.start(source.id, 'proxy')
  const result = await until(() => queue.status(source.id, 'proxy'))
  assert.equal(result.phase, 'ready', result.error)
  assert.equal(result.encoder, 'CPU')
  assert.equal((await queue.info()).entries, 1)
})

test('real layered previews cache the exact range, switch proxy/original, and leave original MP4 rendering isolated', async t => {
  const queue = createPreviewQueue(store.resolveMedia, undefined, { directory: join(directory, 'proxy-render') })
  t.after(() => queue.close())
  queue.start(source.id, 'proxy', 360, 'cpu')
  assert.equal((await until(() => queue.status(source.id, 'proxy'))).phase, 'ready')
  let proxyReads = 0
  const service = createExportService({ desktop: true, resolveMedia: store.resolveMedia, toolsReady: true,
    resolveProxy: (...args) => { proxyReads++; return queue.playable(...args) } })
  const request = await render(service, t)
  async function encode(preview, contents = settings) {
    const response = await request('', 'POST', { ...contents, preview })
    assert.equal(response.status, 201)
    const { id } = await response.json()
    return until(async () => (await request('/' + id)).json())
  }
  const fetchFile = async (job, resource, name) => {
    assert.equal(job.phase, 'ready', job.error)
    const response = await request('/' + job.id + '/' + resource)
    assert.equal(response.status, 200)
    const path = join(directory, name)
    await writeFile(path, Buffer.from(await response.arrayBuffer()))
    return path
  }
  const complete = async job => assert.equal((await request('/' + job.id, 'DELETE')).status, 200)
  const range = { from: 30, to: 75 }
  const original = await encode(range)
  const image = await fetchFile(original, 'monitor', 'original-preview.mp4')
  assert.equal((await request('/' + original.id + '/download')).status, 404)
  await complete(original)
  const away = await encode({ from: 0, to: 29 })
  await complete(away)
  const hit = await encode(range)
  assert.equal(hit.cacheHit, true)
  assert.equal(hit.verification.duration, original.verification.duration)
  await complete(hit)
  const proxy = await encode({ ...range, proxy: 360 })
  assert.equal(proxy.proxyCount, 1)
  assert.equal(proxy.verification.audio, true)
  const reduced = await fetchFile(proxy, 'monitor', 'proxy-preview.mp4')
  const frame = (path, seconds) => ff('-ss', seconds, '-i', path, '-frames:v', '1', '-an', '-f', 'framemd5', '-').toString().split('\n').at(-2)
  assert.notEqual(frame(image, '0.8'), frame(reduced, '0.8'))
  await complete(proxy)
  const readsBeforeExport = proxyReads
  const final = await encode(undefined)
  const file = await fetchFile(final, 'file', 'final.mp4')
  assert.equal(proxyReads, readsBeforeExport)
  const info = await probe(file, 'mp4', AbortSignal.timeout(5000))
  const [video, audio] = ['video', 'audio'].map(kind => info.streams.find(stream => stream.codec_type === kind))
  assert.deepEqual([video.width, video.height, Number(video.nb_frames), audio.codec_name], [1280, 720, 90, 'aac'])
  assert.ok(Math.abs(Number(audio.duration) - Number(video.duration)) < .035)
  await complete(final)
  await unlink((await queue.playable(source.id, 360)).path)
  const fallback = await encode({ ...range, proxy: 360 })
  assert.equal(fallback.proxyCount, 0)
  assert.equal(fallback.cacheHit, true)
  await complete(fallback)
  const fileInfo = await lstat(store.resolveMedia(source.id).path)
  await utimes(store.resolveMedia(source.id).path, fileInfo.atime, new Date(fileInfo.mtimeMs - 10000))
  const changed = await encode(range)
  assert.equal(changed.cacheHit, undefined)
  await complete(changed)
  assert.ok(service.previewCacheInfo().entries <= 6)
  assert.ok(await service.clearPreviews())
  assert.equal(service.previewCacheInfo().bytes, 0)
})

test('audio analysis returns measured values and rejects silent sources', async t => {
  const service = createExportService({ desktop: true, resolveMedia: store.resolveMedia, toolsReady: true })
  const request = await render(service, t)
  const requestAudio = async mediaId => {
    const initial = await request('', 'POST', { kind: 'audio-analysis', mediaId, start: .25, end: 1.75 })
    assert.equal(initial.status, 201)
    const { id } = await initial.json()
    return until(async () => (await request('/' + id)).json())
  }
  const job = await requestAudio(source.id)
  assert.equal(job.phase, 'ready', job.error)
  const report = await (await request('/' + job.id + '/audio')).json()
  assert.equal(report.duration, 1.5)
  assert.ok(report.integrated < -5 && report.integrated > -65)
  assert.ok(report.peak <= 0 && report.peak > -30)
  assert.equal(typeof report.streamDeltaMs, 'number')
  await request('/' + job.id, 'DELETE')
  const silentJob = await requestAudio(silent.id)
  assert.equal(silentJob.error, 'noAudio')
})

test('approved plan applies exact cuts and subtitles as a single reversible edit', async () => {
  const project = { ...settings, version: 2, clips: [], media: [], burn: true }
  const cue = { start: .4, end: .9, text: 'Konuşma' }
  const frame = { mode: 'vertical', zoom: 1, x: 0, y: 0 }
  const plan = { resolution: 1080, encoder: 'cpu', items: [{ start: 0, end: 3, frame,
    remove: [{ start: 1, end: 1.5 }], overlay: { appearance: defaultAppearance, cues: [cue] } }] }
  assert.ok(speechCutInside({ start: .6, end: 2 }, [cue]))
  const next = appendApprovedShorts(project, source, plan)
  assert.deepEqual(next.clips.map(({ start, end }) => [start, end]), [[0, 1], [1.5, 3]])
  assert.equal(next.timeline, project.timeline)
  assert.deepEqual(next.media[0].cues, [cue])
  const history = historyReducer({ previous: [], present: project, next: [] }, { type: 'update', apply: () => next })
  assert.equal(historyReducer(history, { type: 'undo' }).present, project)
  const file = join(directory, 'approved.viralcut')
  await store.save(file, { ...next, timeline: undefined, version: 1 })
  assert.equal((await store.open(file)).clips.length, 2)
})
