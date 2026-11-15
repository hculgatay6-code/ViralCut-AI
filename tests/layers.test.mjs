import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createProjectStore, projectDocument } from '../desktop/projects.mjs'
import { encodeLayeredSequence, validateLayeredSequence } from '../server/layers.mjs'
import { createExportService } from '../server/export.mjs'
import { timelineDocument } from '../server/timeline-document.mjs'
import { changeGap, deleteSelection, emptyTrack, layerFromLegacy, mediaClip, mergeLayerClip, moveSelection, snapFrame,
  splitLayerClip, putLayerClip } from '../src/project/layer-model.ts'
import { historyReducer } from '../src/project/model.ts'

const ff = (...args) => execFileSync(process.env.VIRALCUT_FFMPEG ?? 'ffmpeg', ['-v','error','-nostdin',...args],
  { windowsHide: true, maxBuffer: 8e6, timeout: 30000 })
const profile = { resolution: 720, fps: 30, quality: 'balanced', bitrate: 0 }
const appearance = { style: 'classic', font: 'arial', position: 'bottom', size: 52, textColor: '#ffffff',
  highlightColor: '#b7fa70', backgroundColor: '#151515', highlight: false }
const base = { version: 1, clips: [], media: [], profile, appearance, burn: true, encoder: 'cpu' }
let folder, videoA, videoB, tone1, tone2, tone3
before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'viralcut-v19-test-'))
  videoA = join(folder, 'blue.mp4'); videoB = join(folder, 'red.mp4')
  for (const [path, color] of [[videoA, 'blue'], [videoB, 'red']]) ff(
    '-f','lavfi','-i', 'color=c=' + color + ':s=640x360:r=30', '-t','2','-c:v','libx264','-threads','2',path)
  const tones = [440, 730, 910].map(frequency => {
    const path = join(folder, frequency + '.wav')
    ff('-f','lavfi','-i','sine=frequency=' + frequency + ':sample_rate=48000','-t','2','-c:a','pcm_s16le',path)
    return path
  })
  tone1 = tones[0]; tone2 = tones[1]; tone3 = tones[2]
})
after(async () => { if (folder) await rm(folder, { recursive: true, force: true }) })

test('frame edits validate locks, snapping, cross-track group movement, trims, splits, joins and ripple gaps', () => {
  const media = crypto.randomUUID()
  const clips = [mediaClip(media, 'video', 0, 8, 30), mediaClip(media, 'video', 45, 60, 15)]
  const bottom = { ...emptyTrack('video', 'V1'), clips }
  const top = emptyTrack('video', 'V2')
  const timeline = { fps: 30, tracks: [bottom, top] }
  assert.equal(snapFrame(timeline, 31, 0, 3), 30)
  assert.equal(moveSelection(timeline, new Set([clips[0].id]), 18), null)
  assert.equal(moveSelection({ ...timeline, tracks: [bottom, { ...top, locked: true }] }, new Set([clips[0].id]), 0, top.id), null)
  const moved = moveSelection(timeline, new Set(clips.map(clip => clip.id)), 5, top.id)
  assert.deepEqual(moved.tracks.map(row => row.clips.map(clip => clip.at)), [[], [5, 50]])
  const split = splitLayerClip(timeline, bottom, clips[0], 12)
  assert.equal(split.tracks[0].clips[1].inFrame, 20)
  assert.deepEqual(mergeLayerClip(split, split.tracks[0], split.tracks[0].clips[0]), timeline)
  assert.deepEqual(putLayerClip(timeline, bottom.id, { ...clips[0], length: 20 }, true).tracks[0].clips.map(clip => clip.at), [0, 35])
  assert.equal(deleteSelection(timeline, new Set([clips[0].id]), false).tracks[0].clips[0].at, 45)
  assert.equal(deleteSelection(timeline, new Set([clips[0].id]), true).tracks[0].clips[0].at, 15)
  assert.equal(changeGap(timeline, bottom, 30, -1).tracks[0].clips[1].at, 30)
  assert.equal(changeGap(timeline, bottom, 30, 30).tracks[0].clips[1].at, 75)
  assert.throws(() => timelineDocument({ ...timeline, tracks: [{ ...bottom, clips: [clips[0], { ...clips[1], at: 5 }] }] }, () => true), /badTimeline/)

  const saved = { ...base, version: 2, timeline }
  let history = { previous: [], present: saved, next: [] }
  history = historyReducer(history, { type: 'update', apply: value => ({ ...value, timeline: moved }) })
  history = historyReducer(history, { type: 'undo' })
  assert.equal(history.present, saved)
  assert.equal(historyReducer(history, { type: 'redo' }).present.timeline, moved)
})

test('opening v1 and saving as v2 retains original trims, effects, caption drafts, and safe media relinking', async () => {
  const store = createProjectStore(join(folder,'recovery.viralcut'))
  const mediaPath = join(folder, 'original.mp4')
  ff('-i',videoA,'-c','copy',mediaPath)
  const media = await store.register(mediaPath)
  const audio = await store.register(tone1, false, true)
  assert.equal(audio.audioOnly, true)
  await assert.rejects(store.register(tone1), /badProject/)
  const old = { ...base, media: [{ ...media, cues: [{ start: .2, end: .8, text: 'Türkçe kayıt' }] }],
    clips: [{ id: crypto.randomUUID(), mediaId: media.id, start: .1, end: 1.6, muteAudio: true,
      transition: { kind: 'fade', duration: .25 } }] }
  const oldPath = join(folder, 'v18.viralcut')
  const nextPath = join(folder, 'v19.viralcut')
  await store.save(oldPath, old)
  const v1Bytes = await readFile(oldPath)
  const opened = await store.open(oldPath)
  const timeline = layerFromLegacy(opened)
  timeline.tracks[1].clips.push(mediaClip(audio.id, 'audio', 0, 0, 45))
  const upgraded = { ...opened, version: 2, timeline, media: [...opened.media, audio] }
  await store.save(nextPath, upgraded)
  await store.autosave(upgraded)
  assert.deepEqual(await readFile(oldPath), v1Bytes)
  const loaded = await store.open(nextPath)
  assert.equal(loaded.version, 2)
  assert.deepEqual(loaded.clips[0].transition, old.clips[0].transition)
  assert.equal(loaded.clips[0].start, .1)
  assert.equal(loaded.timeline.tracks[2].clips[0].text, 'Türkçe kayıt')
  assert.equal(loaded.timeline.tracks[0].clips[0].mediaId, loaded.media[0].id)
  assert.equal(loaded.timeline.tracks[1].clips[0].mediaId, loaded.media[1].id)
  assert.deepEqual((await store.recover()).timeline.tracks.map(track => track.name), ['V1', 'A1', 'CC1'])
  const broken = JSON.parse(await readFile(nextPath, 'utf8'))
  broken.timeline.tracks[0].clips[0].mediaId = audio.id
  assert.throws(() => projectDocument(broken), /badTimeline/)
  const moved = join(folder, 'moved.mp4')
  await rename(mediaPath, moved)
  const missing = (await store.open(nextPath)).media[0]
  assert.equal(missing.missing, true)
  assert.equal((await store.relink(missing.id, moved)).missing, false)
})

function pixel(file, time, x, y) {
  return [...ff('-ss', String(time), '-i', file, '-frames:v','1','-vf',`crop=4:4:${x}:${y},scale=1:1`,
    '-c:v','rawvideo','-threads','1','-pix_fmt','rgb24','-f','rawvideo','-')]
}

function spectrum(file, time) {
  const data = ff('-ss', String(time), '-i',file,'-t','0.2','-vn','-ac','1','-ar','48000','-c:a','pcm_f32le','-f','f32le','-')
  return [440, 730, 910].map(frequency => {
    let real = 0, imaginary = 0
    for (let offset = 0; offset < data.length; offset += 4) {
      const radians = 2 * Math.PI * frequency * offset / 192000
      const value = data.readFloatLE(offset)
      real += value * Math.cos(radians)
      imaginary += value * Math.sin(radians)
    }
    return Math.hypot(real, imaginary) * 8 / data.length
  })
}

test('real MP4 composites two pictures, three frequencies, visible Turkish titles, accurate gaps and an identical preview composition', async t => {
  const store = createProjectStore(join(folder,'unused.viralcut'))
  const [b, r] = await Promise.all([store.register(videoA), store.register(videoB)])
  const tones = await Promise.all([tone1,tone2,tone3].map(path => store.register(path, false, true)))
  const tracks = [
    { ...emptyTrack('video', 'V1'), clips: [mediaClip(b.id, 'video', 0, 0, 60)] },
    { ...emptyTrack('video', 'V2'), clips: [{ ...mediaClip(r.id, 'video', 15, 0, 30), x: 1, y: 0, scale: .5 }] },
    ...tones.map(({ id }, index) => ({ ...emptyTrack('audio', 'A' + (index + 1)), clips: [mediaClip(id, 'audio', 15, 0, 30)] })),
    { ...emptyTrack('text','T1'), clips: [{ id: crypto.randomUUID(), at: 20, length: 15, text: 'Türkçe başlık' }] },
  ]
  const settings = { ...base, timeline: { fps: 30, tracks }, encoder: 'auto' }
  const elapsed = performance.now()
  const output = join(folder,'layers.mp4')
  async function render(settings, output) {
    const work = validateLayeredSequence(settings, store.resolveMedia)
    return encodeLayeredSequence({ ...work, directory: folder, output, signal: AbortSignal.timeout(60000), onProgress() {} })
  }
  const result = await render(settings, output)
  assert.deepEqual([result.verification.width, result.verification.height, result.verification.fps], [1280,720,30])
  assert.ok(Math.abs(result.verification.duration - 2) < .04)
  assert.deepEqual(pixel(output, .2, 900, 50).map(color => color > 180), [false, false, true])
  assert.deepEqual(pixel(output, .8, 900, 50).map(color => color > 180), [true, false, false])
  assert.deepEqual(pixel(output, .8, 70, 50).map(color => color > 180), [false, false, true])
  assert.deepEqual(pixel(output, 1.7, 900, 50).map(color => color > 180), [false, false, true])
  const title = ff('-ss','0.80','-i',output,'-frames:v','1','-vf','crop=600:150:340:35',
    '-c:v','rawvideo','-threads','1','-pix_fmt','gray','-f','rawvideo','-')
  assert.ok(title.some(value => value > 200))
  const frequencies = spectrum(output, .7)
  assert.ok(frequencies.every(value => value > .05), JSON.stringify(frequencies))
  assert.ok(spectrum(output, .05).every(value => value < .005))
  const preview = join(folder,'layers-preview.mp4')
  await render({ ...settings, preview: { from: 18, to: 42 } }, preview)
  assert.deepEqual(pixel(output, .8, 900, 50), pixel(preview, .2, 900, 50))
  assert.ok(spectrum(preview, .1).every(value => value > .05))
  let next = tracks.map((track, i) => i === 3 ? { ...track, solo: true, gain: .5 } : track)
  next = next.map((track, i) => i === 1 ? { ...track, hidden: true } : track)
  const solo = join(folder, 'solo.mp4')
  const cpu = await render({ ...settings, encoder: 'cpu', timeline: { fps: 30, tracks: next } }, solo)
  assert.equal(cpu.encoder, 'CPU')
  const soloLevels = spectrum(solo, .7)
  assert.ok(soloLevels[0] < .005 && soloLevels[1] > .025 && soloLevels[1] < frequencies[1] * .65 && soloLevels[2] < .005)
  assert.deepEqual(pixel(solo, .8, 900, 50).map(color => color > 180), [false, false, true])
  t.diagnostic(JSON.stringify({ ...result.verification, encoder: result.encoder, testMs: Math.round(performance.now() - elapsed), frequencies, soloLevels }))
})

test('export service rejects invalid preview bounds and safely cancels a job, then retries', async () => {
  const store = createProjectStore(join(folder,'test-jobs.viralcut'))
  const video = await store.register(videoA)
  const track = { ...emptyTrack('video', 'V1'), clips: [mediaClip(video.id, 'video', 0, 0, 60)] }
  const body = { ...base, kind:'sequence', timeline: { fps: 30, tracks: [track] } }
  const service = createExportService({ desktop: true, resolveMedia: store.resolveMedia })
  const server = createServer((req, res) => service.middleware(req,res,() => res.end(),server.address()))
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  const url = 'http://127.0.0.1:' + server.address().port + '/api/export'
  const signal = AbortSignal.timeout(30000)
  const request = (path, options) => fetch(url + path, { ...options, signal, headers: { 'X-ViralCut':'2', ...options?.headers } })
  const post = data => request('', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) })
  try {
    assert.equal((await post({ ...body, preview: { from: 0, to: 61 } })).status, 400)
    const created = await post(body)
    let job = await created.json()
    assert.equal(created.status, 201, JSON.stringify(job))
    assert.equal((await request('/' + job.id, { method: 'DELETE' })).status, 200)
    const retry = await post(body)
    job = await retry.json()
    assert.equal(retry.status, 201, JSON.stringify(job))
    while (job.phase === 'processing') {
      await new Promise(resolve => setTimeout(resolve, 100))
      job = await (await request('/' + job.id)).json()
    }
    assert.equal(job.phase, 'ready', JSON.stringify(job))
  } finally {
    await service.close()
    await new Promise(resolve => server.close(resolve))
  }
})

test('a source audio stream with a positive start offset stays synchronized across composition boundaries', async () => {
  const input = join(folder, 'offset.mp4')
  ff('-f','lavfi','-i','color=c=blue:s=640x360:r=30','-itsoffset','0.4','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
    '-t','2','-c:v','libx264','-threads','2','-c:a','aac',input)
  const output = join(folder, 'offset-render.mp4')
  const store = createProjectStore(join(folder, 'offset.viralcut'))
  const asMedia = await store.register(input)
  const overlay = await store.register(videoB)
  const tracks = [
    { ...emptyTrack('video', 'V1'), clips: [mediaClip(asMedia.id,'video',0,0,60)] },
    { ...emptyTrack('video', 'V2'), clips: [{...mediaClip(overlay.id,'video',9,0,21),scale:.5}] },
    { ...emptyTrack('audio', 'A1'), clips: [mediaClip(asMedia.id,'audio',0,0,60)] },
  ]
  const job = validateLayeredSequence({ ...base, timeline: { fps:30, tracks } },store.resolveMedia)
  await encodeLayeredSequence({ ...job, directory:folder, output, signal:AbortSignal.timeout(30000), onProgress(){} })
  const pcm = ff('-i',output,'-vn','-ac','1','-ar','48000','-c:a','pcm_s16le','-f','s16le','-')
  let first = -1
  for (let offset = 0; offset < pcm.length; offset += 2) {
    if (Math.abs(pcm.readInt16LE(offset)) > 1200) { first = offset / 96000; break }
  }
  assert.ok(Math.abs(first - .4) <= 1 / 30, 'first tone = ' + first)
})
