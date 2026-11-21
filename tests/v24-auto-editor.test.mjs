import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createProjectStore } from '../desktop/projects.mjs'
import { encodeLayeredSequence, validateLayeredSequence } from '../server/layers.mjs'
import { probe } from '../server/media.mjs'
import { readShortsAnalysis, startShortsBatch } from '../server/shorts-batch.mjs'
import { timelineDocument } from '../server/timeline-document.mjs'
import { approveProfessionalPlan } from '../src/editor/approved-shorts.ts'
import { defaultProfile, historyReducer } from '../src/project/model.ts'
import { defaultAppearance } from '../src/subtitles/model.ts'

const frame = { mode: 'vertical', zoom: 1, x: 0, y: 0 }
const source = { id: crypto.randomUUID(), name: 'Take', size: 0, missing: false, cues: [] }
const base = { version: 1, media: [], clips: [], profile: { ...defaultProfile, resolution: 720 },
  appearance: defaultAppearance, encoder: 'cpu', burn: false }
const cue = { start: 1.8, end: 2.35, text: 'Türkçe altyazı' }
const plan = { resolution: 720, encoder: 'cpu', items: [{
  start: 0, end: 3, remove: [{ start: 1, end: 1.5 }], frame,
  overlay: { appearance: defaultAppearance, cues: [cue] }, effects: { voice: true, noise: 7 }, edgeFade: true,
}] }

test('approved cuts rebase caption frames and preserve existing timelines through undo and redo', () => {
  const added = approveProfessionalPlan(base, source, plan)
  const [video, audio, caption] = added.timeline.tracks
  assert.deepEqual(video.clips.map(({ at, inFrame, length }) => [at, inFrame, length]), [[0, 0, 30], [30, 45, 45]])
  assert.deepEqual(audio.clips.map(({ at, inFrame, length }) => [at, inFrame, length]), [[0, 0, 30], [30, 45, 45]])
  assert.deepEqual(caption.clips.map(({ at, length, text }) => [at, length, text]), [[39, 17, cue.text]])
  const appended = approveProfessionalPlan(added, source, { ...plan, items: [{ ...plan.items[0], frame: { ...frame, mode: 'square' } }] }, false)
  assert.equal(appended.frame.mode, 'vertical')
  assert.equal(appended.timeline.tracks[3].clips[0].at, 75)
  assert.equal(appended.timeline.tracks.filter(row => row.kind === 'audio').length, 1)
  const history = historyReducer({ previous: [], present: added, next: [] }, { type: 'update', apply: () => appended })
  const undone = historyReducer(history, { type: 'undo' })
  assert.equal(undone.present, added)
  assert.equal(historyReducer(undone, { type: 'redo' }).present, appended)
})

test('approval rejects invalid pauses and unsafe or malformed crop values cannot reach FFmpeg', () => {
  assert.equal(approveProfessionalPlan(base, source, { ...plan, items: [
    { ...plan.items[0], remove: [{start: 1, end: 2}, {start: 1.5, end: 2.5}] },
  ] }), undefined)
  const { timeline } = approveProfessionalPlan(base, source, plan)
  timeline.tracks[0].clips[0].reframe.x = '0:unsafe'
  assert.throws(() => timelineDocument(timeline, () => true))
  const analysis = { language: 'tr', device: 'cpu', duration: 90, goal: 42, analysis: { threshold: -40, minimum: .4 } }
  assert.equal(readShortsAnalysis(analysis).goal, 42)
  assert.throws(() => readShortsAnalysis({ ...analysis, goal: 60.1 }), /badEdit/)
})

const ff = (...args) => execFileSync(process.env.VIRALCUT_FFMPEG ?? 'ffmpeg',
  ['-v', 'error', '-nostdin', ...args], { windowsHide: true, maxBuffer: 3e6, timeout: 90000 })

test('edited timeline persists and renders a cropped portrait MP4 with synchronized audio and Turkish captions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'viralcut-v24-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const input = join(dir, 'source.mp4')
  ff('-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30', '-f', 'lavfi', '-i', 'sine=frequency=480',
    '-t', '3', '-c:v', 'libx264', '-threads:v', '2', '-c:a', 'aac', input)
  const original = await readFile(input)
  const store = createProjectStore(join(dir, 'recovery.viralcut'))
  const registered = await store.register(input)
  const tracked = { ...frame, track: [{ time: 0, x: -.6 }, { time: 3, x: .6 }] }
  const project = approveProfessionalPlan(base, registered, { ...plan, items: [{ ...plan.items[0], frame: tracked }] })
  await store.save(join(dir, 'edit.viralcut'), project)
  const reopened = await store.open(join(dir, 'edit.viralcut'))
  assert.deepEqual(reopened.timeline.tracks[0].clips[0].reframe.track, tracked.track)
  assert.ok(reopened.timeline.tracks[1].clips[1].audioTreatment.voice)
  assert.equal(reopened.timeline.tracks[2].clips[0].text, cue.text)
  const signal = new AbortController().signal
  const output = join(dir, 'edit.mp4')
  const preview = join(dir, 'preview.mp4')
  async function render(path, range, burn = true) {
    return encodeLayeredSequence({ ...validateLayeredSequence({ ...reopened, burn, preview: range }, store.resolveMedia),
      signal, directory: dir, output: path, onProgress() {} })
  }
  const start = performance.now()
  const result = await render(output)
  const fullMs = performance.now() - start
  await render(preview, { from: 30, to: 75 })
  const rawFrame = (path, at) => ff('-ss', String(at), '-i', path, '-frames:v', '1', '-vf', 'scale=90:160',
    '-pix_fmt', 'gray', '-c:v', 'rawvideo', '-threads:v', '1', '-f', 'rawvideo', '-')
  const full = rawFrame(output, 1.5), monitor = rawFrame(preview, .5)
  const diff = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length
  const mean = diff(full, monitor)
  assert.ok(mean < 3, String(mean))
  const captionless = join(dir, 'captionless.mp4')
  await render(captionless, { from: 30, to: 75 }, false)
  assert.ok(diff(monitor, rawFrame(captionless, .5)) > .08)
  assert.ok(diff(rawFrame(preview, .1), rawFrame(captionless, .1)) < 2)
  const info = await probe(output, 'mp4', signal)
  const [video, audio] = ['video', 'audio'].map(kind => info.streams.find(stream => stream.codec_type === kind))
  const driftMs = 1000 * Math.abs(Number(video.duration) - Number(audio.duration))
  assert.ok(driftMs <= 45)
  assert.equal(result.verification.captions, true)
  assert.deepEqual([video.width, video.height, +video.nb_frames, audio.codec_name], [720, 1280, 75, 'aac'])
  assert.deepEqual(await readFile(input), original)
  t.diagnostic(JSON.stringify({ fullMs: Math.round(fullMs), encoder: result.encoder, driftMs, meanPixelDifference: mean }))
})

test('batch isolates a failed item and exports verified square and landscape clips', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'viralcut-v24-batch-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dest = join(dir, 'exports')
  await mkdir(dest)
  const input = join(dir, 'source.mp4')
  ff('-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30', '-f', 'lavfi', '-i', 'sine=frequency=480',
    '-t', '15.1', '-c:v', 'libx264', '-threads:v', '2', '-c:a', 'aac', input)
  const store = createProjectStore(join(dir, 'recovery.viralcut'))
  const media = await store.register(input)
  const items = ['invalid', 'square', 'landscape'].map(mode => ({ start: 0, end: 15, remove: [], frame: { ...frame, mode } }))
  const batch = startShortsBatch({ items, resolution: 720, encoder: 'cpu' }, store.resolveMedia(media.id), dest,
    path => rm(path, { recursive: true, force: true }), 'viralcut-v24-batch-')
  await batch.work
  const results = batch.snapshot().items
  assert.deepEqual(results.map(item => item.phase), ['failed', 'ready', 'ready'], JSON.stringify(results))
  const dimensions = []
  for (const item of results.slice(1)) {
    const info = await probe(join(dest, item.filename), 'mp4', new AbortController().signal)
    const [video, audio] = ['video', 'audio'].map(kind => info.streams.find(stream => stream.codec_type === kind))
    dimensions.push([video.width, video.height, audio.codec_name])
  }
  assert.deepEqual(dimensions, [[720, 720, 'aac'], [1280, 720, 'aac']])
})
