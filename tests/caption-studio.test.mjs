import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildAss, validateOverlay } from '../server/ass.mjs'
import { captionMotion, captionParts, hasReliableWords } from '../server/caption-design.mjs'
import { encodeClip, probe } from '../server/media.mjs'

const design = { font: 'arial', size: 55, style: 'bold', position: 'bottom', highlight: true,
  safe: true, motion: 'fade', highlightMode: 'karaoke', textColor: '#ffffff', backgroundColor: '#080808', highlightColor: '#00ff00' }
const cue = { start: .2, end: 2.6, text: 'Türkçe örnek', words: [
  { start: .28, end: 1.1, text: 'Türkçe' }, { start: 1.35, end: 2.3, text: ' örnek' },
] }

test('caption timing uses original cue timestamps across a trim and rejects unsafe design properties', () => {
  assert.ok(hasReliableWords(cue))
  assert.deepEqual(captionParts(cue, design, 1.5, true).map(item => item.color), ['#00ff00', '#00ff00'])
  const damaged = { ...cue, words: [{ start: .2, end: .4, text: cue.text }] }
  assert.equal(hasReliableWords(damaged), false)
  assert.equal(captionMotion(damaged, { ...design, motion: 'bounce' }, .2, false).opacity, 0)
  for (const change of [{ speed: 0 }, { y: 100 }, { outlineColor: '{ASS}' }, { shadow: 20 }, { highlightMode: 'bad' }]) {
    assert.throws(() => validateOverlay({ cues: [cue], appearance: { ...design, ...change } }), /badSubtitles/)
  }
  const full = buildAss({ cues: [cue], appearance: design }, 0, 3, { mode: 'vertical' })
  const clipped = buildAss({ cues: [cue], appearance: design }, 1.5, 3, { mode: 'vertical' })
  assert.match(full, /PlayResX: 608/)
  assert.match(clipped, /Dialogue: 0,0:00:00\.00,[^\n]+\\pos\(304,832\).*Türkçe/)
  assert.match(clipped, /&H00ff00&.*örnek/)
  for (const motion of ['pop', 'drop', 'bounce']) {
    const state = captionMotion(cue, { ...design, motion }, cue.start, true)
    assert.ok(state.scale < 1 || state.offset < 0)
  }
})

function ff(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', ...args], { windowsHide: true, timeout: 30000 })
}

test('animated Turkish karaoke burns into a real 720p vertical MP4 with green word progression and AAC', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'viralcut-captions-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const input = join(dir, 'source.mp4'), output = join(dir, 'result.mp4')
  ff(['-f','lavfi','-i','color=c=black:s=640x360:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',input])
  const signal = AbortSignal.timeout(30000)
  await encodeClip({ input, output, format: 'mp4', start: 0, end: 3, signal, directory: dir, onProgress() {},
    edit: { frame: { mode: 'vertical', zoom: 1, x: 0, y: 0 }, remove: [], encoder: 'cpu' },
    profile: { resolution: 720, fps: 30, quality: 'balanced' }, overlay: validateOverlay({ cues: [cue], appearance: design }) })
  const info = await probe(output, 'mp4', signal)
  assert.deepEqual(info.streams.map(stream => stream.codec_type), ['video', 'audio'])
  assert.deepEqual([info.streams[0].width, info.streams[0].height], [720, 1280])
  assert.ok(Math.abs(Number(info.streams[0].duration) - Number(info.streams[1].duration)) < .04)
  function green(time) {
    const raw = ff(['-ss',time,'-i',output,'-vf','scale=360:640','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-'])
    let count = 0
    for (let i = 0; i < raw.length; i += 3) {
      if (raw[i + 1] < 110 || raw[i] > raw[i + 1] - 55 || raw[i + 2] > raw[i + 1] - 55) continue
      const y = Math.floor(i / 1080)
      assert.ok(y > 435 && y < 540, `Subtitle pixel at y=${y}`)
      count++
    }
    return count
  }
  const measurements = ['0.10', '0.24', '0.86', '1.70', '2.80'].map(green)
  assert.equal(measurements[0], 0)
  assert.ok(measurements[1] < measurements[2] && measurements[2] > 30 && measurements[3] > measurements[2])
  assert.equal(measurements[4], 0)
  t.diagnostic(JSON.stringify({ greenPixels: measurements, videoDuration: info.streams[0].duration, audioDuration: info.streams[1].duration }))
})
