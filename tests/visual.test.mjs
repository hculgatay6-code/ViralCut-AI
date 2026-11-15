import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createVisualService } from '../server/visual-service.mjs'
import { rankVisual, subjectTrack } from '../server/visual-ranking.mjs'
import { analyzeShorts, startShortsBatch } from '../server/shorts-batch.mjs'
import { validateEdit } from '../server/shorts.mjs'
import { probe } from '../server/media.mjs'

test('subject coordinates are smoothed and move toward center when detections disappear', () => {
  const face = { label: 'face', score: .95, left: .74, right: .86 }
  const keys = subjectTrack([{ time: 0, boxes: [face] }, { time: 2, boxes: [face] },
    { time: 4, boxes: [] }, { time: 6, boxes: [] }], 0, 6, 16 / 9)
  assert.ok(keys[0].x > 0 && keys[0].x < keys[1].x)
  assert.ok(keys[3].x < keys[2].x)
  assert.deepEqual(subjectTrack([], 0, 15, 16 / 9), [])
  assert.throws(() => validateEdit({ frame: { mode: 'vertical', zoom: 1, x: 0, y: 0, track: [{ time: 0, x: 'bad' }] } }), /badEdit/)
})

test('silent video actually produces a playable portrait short with a validated moving crop', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'viralcut-visual-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const previous = process.env.VIRALCUT_VISION_MODEL
  process.env.VIRALCUT_VISION_MODEL = join(folder, 'missing')
  t.after(() => { if (previous) process.env.VIRALCUT_VISION_MODEL = previous; else delete process.env.VIRALCUT_VISION_MODEL })
  const input = join(folder, 'silent.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-t', '16', '-an',
    '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', input], { windowsHide: true })
  const signal = AbortSignal.timeout(60000)
  const vision = createVisualService()
  const result = await analyzeShorts({ input, format: 'mp4', directory: folder, signal, goal: 15, visualMode: 'gaming',
    visualDevice: 'cpu', vision, onProgress() {}, semantic: { analyze() { throw new Error('silent source must skip speech ranking') } } })
  assert.equal(result.hasAudio, false)
  assert.deepEqual(result.cues, [])
  assert.deepEqual(result.visual.models, ['missing', 'missing'])
  assert.equal(result.selection.mode, 'visual')
  const [first] = result.selection.candidates
  assert.equal(first.end - first.start, 15)
  assert.equal(first.track.length, 0)
  const request = { resolution: 720, encoder: 'cpu', items: [{ start: first.start, end: first.end, remove: [],
    frame: { mode: 'vertical', zoom: 1, x: 0, y: 0, track: [{ time: 0, x: -.7 }, { time: 8, x: .7 }] } }] }
  const batch = startShortsBatch(request, { path: input, format: 'mp4', size: (await stat(input)).size }, folder,
    path => rm(path, { recursive: true, force: true }), 'viralcut-v13-test-')
  await batch.work
  const [item] = batch.snapshot().items
  assert.equal(item.phase, 'ready', JSON.stringify(item))
  const [output] = (await readdir(folder)).filter(name => name.startsWith('ViralCut-Short-'))
  const info = await probe(join(folder, output), 'mp4', signal)
  assert.deepEqual(info.streams.map(s => [s.codec_type, s.width, s.height]), [['video', 720, 1280]])
  const ranked = rankVisual(Array.from({ length: 120 }, (_, time) => ({ time, motion: .1, labels: [], histogram: Array(16).fill(1 / 16) })), 120, 30, true)
  assert.equal(ranked.length, 1)
})
