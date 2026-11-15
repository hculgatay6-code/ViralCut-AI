import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { measureShorts, verifyShort } from '../server/shorts-quality.mjs'
import { rankSemantic, speechUnits } from '../server/semantic-ranking.mjs'
import { parseCues } from '../server/whisper.mjs'

test('short timing overlaps recover without fabricating word times; long Turkish cues split', () => {
  const words = 'Merhaba bugün yerel video düzenleyicimizde uzun altyazı satırlarını konuşmanın ritmini ve Türkçe noktalama işaretlerini koruyarak ayırıyoruz.'.split(' ')
  const segments = words.map((text, index) => ({ text: index ? ' ' + text : text,
    offsets: { from: index * 360 - (index === 1 ? 35 : 0), to: (index + 1) * 360 } }))
  const transcription = [{ text: words.join(' '), offsets: { from: 0, to: 6000 }, tokens: segments }]
  const result = parseCues({ transcription }, 5, 7)
  assert.ok(result.length >= 2)
  assert.ok(result.every(cue => cue.text.length <= 84 && cue.words.map(word => word.text).join('') === cue.text))
  assert.equal(result.map(cue => cue.text).join(' '), transcription[0].text)
  assert.equal(result[0].words[1].start, result[0].words[0].end)
  segments[1].offsets.from = 120
  assert.equal(parseCues({ transcription }, 0, 7)[0].words, undefined)
})

test('ranking shows energy, scene and word coverage without dropping sentence boundaries', () => {
  const lines = [{ start: 1, end: 8, text: 'Today we discuss realistic audio editing.', words: [{ start: 1.1, end: 7.8 }] },
    { start: 9, end: 17, text: 'The final result preserves the complete sentence.', words: [{ start: 9.1, end: 16.9 }] }]
  const result = rankSemantic(speechUnits(lines, 18), null, [], 18, 15, () => {},
    { stride: 1, energy: [{ time: 1, db: -21 }, { time: 2, db: -23 }], scenes: [1] })[0]
  assert.ok(result.start < 1 && result.end > 17)
  assert.ok(result.evaluation.metrics.energy > 80)
  assert.equal(result.evaluation.metrics.scene, 100)
  assert.equal(result.evaluation.metrics.timing, 100)
  assert.ok(result.evaluation.reasons.includes('scene'))
})

test('real FFmpeg reports scenes and energy, warns for black and quiet output, and rejects missing audio', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'viralcut-quality-v12-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', ...args], { windowsHide: true })
  const visual = join(folder, 'visual.mp4'), warning = join(folder, 'warning.mp4'), mute = join(folder, 'mute.mp4')
  ff(['-f','lavfi','-i','color=black:s=720x1280:r=30','-f','lavfi','-i','sine=f=440:r=48000',
    '-vf',"drawbox=c=white:t=fill:enable='gte(t,1)'",'-t','3','-c:v','libx264','-threads','2','-c:a','aac',visual])
  ff(['-f','lavfi','-i','color=black:s=720x1280:r=30','-f','lavfi','-i','anullsrc=r=48000:cl=mono',
    '-t','3','-c:v','libx264','-threads','2','-c:a','aac',warning])
  ff(['-i',visual,'-an','-c:v','copy',mute])
  const signal = AbortSignal.timeout(20000)
  const diagnostics = await measureShorts({ input: visual, format: 'mp4', duration: 3, signal, onProgress() {} })
  assert.ok(diagnostics.energy.some(sample => sample.db > -35 && sample.time >= 0))
  assert.ok(diagnostics.scenes.some(time => Math.abs(time - 1) < .26))
  const settings = { start: 0, end: 3, edit: { remove: [] }, profile: { resolution: 720 } }
  assert.deepEqual(await verifyShort(visual, settings, signal), ['blackFrames'])
  assert.deepEqual(await verifyShort(warning, settings, signal), ['blackFrames', 'quietOutput'])
  await assert.rejects(verifyShort(mute, settings, signal), /noAudio/)
  await assert.rejects(verifyShort(visual, { ...settings, end: 2 }, signal), /verifyFailed/)
  await assert.rejects(measureShorts({ input: visual, format: 'mp4', duration: 3, onProgress() {}, signal: AbortSignal.abort() }), { name: 'AbortError' })
  t.diagnostic(JSON.stringify(diagnostics))
})
