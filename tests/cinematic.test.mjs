import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { encodeClip, probe, run } from '../server/media.mjs'
import { measureLoudness } from '../server/studio-audio.mjs'
import { validateBatchItem } from '../server/shorts-batch.mjs'
import { verifyShort } from '../server/shorts-quality.mjs'
import { cinematicLook, studioDefaults } from '../src/editor/cinematic.ts'
import { subjectTrack } from '../server/visual-ranking.mjs'

test('cinematic look keeps gaming HUD, moderates grading and avoids zoom across a scene cut', () => {
  const clip = { start: 0, end: 25, visual: { motion: 10 }, picture: { light: 180, bright: .3, tint: 24, cuts: [4], wideFaces: false } }
  const cues = [{ start: 3, end: 7, text: 'Görüntü ve ses birlikte işlendi.' }]
  const gaming = cinematicLook('gaming', clip, cues, studioDefaults)
  assert.equal(gaming.contain, true)
  assert.equal(gaming.effects.zoom, undefined)
  const podcast = cinematicLook('podcast', clip, cues, studioDefaults)
  assert.equal(podcast.effects.zoom, undefined)
  assert.ok(podcast.effects.brightness < 0)
  assert.ok(podcast.effects.warmth < 0)
  assert.equal(cinematicLook('podcast', clip, cues, { ...studioDefaults, intensity: 'off' }).edgeFade, false)
  const tracks = subjectTrack([{ time: 0, boxes: [{ label: 'face', score: .9, left: .9, right: 1 }] },
    { time: 1, boxes: [{ label: 'face', score: .9, left: 0, right: .1 }] }], 0, 20, 16 / 9, true)
  assert.ok(Math.abs(tracks[1].x - tracks[0].x) <= .38)
})

test('FFmpeg masters the complete clip, mixes selected music, and verifies the rendered output', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'viralcut-v15-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const signal = AbortSignal.timeout(60000)
  const input = join(directory, 'input.mp4'), output = join(directory, 'output.mp4')
  const song = join(directory, 'bed.wav')
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=480x272:r=30:d=18',
    '-f', 'lavfi', '-i', 'sine=f=400:d=18', '-c:v', 'libx264', '-c:a', 'aac', '-ac', '2', input], signal)
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=800:d=3', song], signal)
  const item = { start: 0, end: 18, remove: [{ start: 8, end: 9 }], frame: { mode: 'vertical', x: 0, y: 0, zoom: 1, fit: 'contain' },
    effects: { warmth: -.025, fadeIn: .16, fadeOut: .2 }, mastering: { target: -16, musicLevel: .14 } }
  const settings = validateBatchItem(item, { resolution: 720, encoder: 'cpu' })
  assert.throws(() => validateBatchItem({ ...item, mastering: { target: '-14', musicLevel: .14 } }, { resolution: 720, encoder: 'cpu' }))
  await encodeClip({ ...settings, input, output, format: 'mp4', directory, music: { path: song, format: 'wav' }, signal, onProgress() {} })
  const original = await measureLoudness(input, signal)
  const result = {}
  await verifyShort(output, settings, signal, true, result)
  assert.ok(original.integrated < -19)
  assert.ok(Math.abs(result.quality.integrated + 16) < 1.5)
  assert.ok(result.quality.peak < -1.2)
  assert.ok(result.quality.avDeltaMs < 50)
  assert.equal((await probe(output, 'mp4', signal)).streams[0].width, 720)
  t.diagnostic(JSON.stringify({ original, output: result.quality }))
})
