import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createPreviewQueue } from '../server/preview.mjs'
import { probe } from '../server/media.mjs'
import { encodeSequence, validateSequence } from '../server/sequence.mjs'
import { timelineLayout, subtractSpeech } from '../src/project/model.ts'

let directory, source
const id = 'e93c8e32-46be-4de1-9f34-33da87a07b9a'
const second = 'd47571ac-be60-4b47-aa1e-00af61936865'
const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', ...args], { windowsHide: true })

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'viralcut-v6-studio-test-'))
  const path = join(directory, 'source.mp4')
  ff('-f','lavfi','-i','color=c=blue:s=800x450:r=24','-f','lavfi','-i',
    "aevalsrc=0.9*sin(2*PI*440*t)*gte(t\\,2):s=48000",'-t','5','-c:v','libx264','-threads','2','-c:a','aac',path)
  source = { path, format:'mp4', size:(await stat(path)).size }
})
after(async () => { if (directory) await rm(directory, { recursive:true, force:true }) })

test('timeline places linked audio and cut captions in project time', () => {
  const clips = [{ id:'a', mediaId:id, start:0, end:1 }, { id:'b', mediaId:second, start:4, end:7, muteAudio:true }]
  const sources = [{ id:second, cues:[{start:3,end:5,text:'Başlangıç'},{start:6,end:8,text:'Bitiş'}] }]
  const edited = subtractSpeech(clips, second, [{start:5.5,end:6.5}])
  const layout = timelineLayout(edited, sources)
  assert.deepEqual(layout.map(({start,end})=>[start,end]), [[0,1],[1,2.5],[2.5,3]])
  assert.deepEqual(layout.flatMap(({captions})=>captions), [
    {text:'Başlangıç',from:1,to:2}, {text:'Bitiş',from:2.5,to:3},
  ])
  assert.ok(edited.slice(1).every(clip=>clip.muteAudio))
})

test('real FFmpeg waveform and bounded proxy with FIFO cancellation and safe cleanup', async () => {
  const queue = createPreviewQueue(media => [id,second].includes(media) ? source : null)
  const signal = AbortSignal.timeout(15000)
  async function finish(media, kind) {
    for (;;) {
      signal.throwIfAborted()
      const info = queue.status(media, kind)
      if (!['queued','running'].includes(info.phase)) return info
      await new Promise(resolve=>setTimeout(resolve,40))
    }
  }
  let proxy
  const original = await readFile(source.path)
  try {
    assert.equal(queue.start('unknown','proxy').error,'badMedia')
    assert.equal(queue.start(id,'proxy').phase,'running')
    assert.equal(queue.start(second,'waveform').phase,'queued')
    assert.equal(queue.cancel(second,'waveform').phase,'cancelled')
    assert.equal((await finish(id,'proxy')).phase,'ready')
    proxy = queue.proxy(id)
    const info = await probe(proxy,'mp4',signal)
    const video = info.streams.find(stream=>stream.codec_type==='video')
    assert.deepEqual([video.width,video.height], [640,360])
    assert.ok(Math.abs(Number(info.format.duration) - 5) < .065)
    queue.start(second,'waveform')
    const wave = await finish(second,'waveform')
    assert.equal(wave.phase,'ready')
    assert.equal(wave.step,1)
    assert.ok(wave.peaks.length >= 5)
    assert.ok(wave.peaks[0] < .01 && wave.peaks[3] > .8, JSON.stringify(wave))
    assert.deepEqual(await readFile(source.path), original)
  } finally { await queue.close() }
  await assert.rejects(access(proxy), { code:'ENOENT' })
})

test('muting one linked audio block keeps its frames and the following audible block synchronized', async () => {
  const output = join(directory,'muted.mp4')
  const task = validateSequence({ profile:{resolution:720,fps:30,quality:'balanced',bitrate:0}, encoder:'cpu', clips:[
    { mediaId:id,start:3,end:4,muteAudio:true }, { mediaId:id,start:3,end:4 },
  ] }, () => source)
  const result = await encodeSequence({ ...task, directory, output, signal:AbortSignal.timeout(15000), onProgress(){} })
  assert.equal(result.verification.duration,2)
  const audio = ff('-i',output,'-vn','-ar','48000','-ac','1','-f','s16le','-')
  let audible = -1
  for (let offset = 0; offset < audio.length; offset += 2) {
    if (Math.abs(audio.readInt16LE(offset)) > 5000) { audible = offset / 96000; break }
  }
  assert.ok(Math.abs(audible - 1) < .035, String(audible))
})

test('prioritized export drains a running proxy and resumes it after processing', async t => {
  const queue = createPreviewQueue(media => [id, second].includes(media) ? source : null)
  t.after(() => queue.close())
  assert.equal(queue.start(id, 'proxy').phase, 'running')
  await queue.prioritize(true)
  assert.equal(queue.status(id, 'proxy').phase, 'queued')
  assert.equal(queue.start(second, 'waveform').phase, 'queued')
  assert.equal(queue.cancel(second, 'waveform').phase, 'cancelled')
  assert.equal(queue.proxy(id), undefined)
  queue.prioritize(false)
  const signal = AbortSignal.timeout(10000)
  while (queue.status(id, 'proxy').phase === 'running') {
    signal.throwIfAborted()
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  assert.equal(queue.status(id, 'proxy').phase, 'ready')
  assert.ok(queue.proxy(id))
})
