import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createProjectStore, projectDocument } from '../desktop/projects.mjs'
import { createExportService } from '../server/export.mjs'
import { encodeSequence, validateSequence } from '../server/sequence.mjs'
import { historyReducer, moveClip, subtractSpeech } from '../src/project/model.ts'

const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', ...args], { windowsHide: true, maxBuffer: 4e6 })
const profile = { resolution: 720, fps: 30, quality: 'balanced', bitrate: 0 }
const appearance = { style: 'classic', font: 'arial', position: 'bottom', size: 52, textColor: '#ffffff',
  highlightColor: '#b7fa70', backgroundColor: '#151515', highlight: false }
const base = { version: 1, clips: [], media: [], profile, appearance, burn: true, encoder: 'cpu' }
let folder, a, b
before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'viralcut-v5-test-'))
  a = join(folder, 'blue.mp4')
  b = join(folder, 'red.webm')
  ff('-f','lavfi','-i','color=c=blue:s=640x360:r=24',
    '-f','lavfi','-i','aevalsrc=0.5*sin(2*PI*440*t):s=44100','-t','2','-c:v','libx264','-c:a','aac',a)
  ff('-f','lavfi','-i','color=c=red:s=360x640:r=25','-t','2','-c:v','libvpx-vp9',b)
})
after(async () => { if (folder) await rm(folder, { recursive: true, force: true }) })

test('undo, redo, reordering and transcript range subtraction are deterministic', () => {
  const one = { id:'a', mediaId:'one', start:0, end:8 }
  const two = { id:'b', mediaId:'two', start:0, end:6 }
  let state = { previous: [], present: { ...base, clips: [one, two] }, next: [] }
  state = historyReducer(state, { type:'update', apply: project => ({ ...project, clips: moveClip(project.clips, 1, 0) }) })
  assert.equal(state.present.clips[0].id, 'b')
  state = historyReducer(state, { type:'undo' })
  assert.equal(state.present.clips[0].id, 'a')
  state = historyReducer(state, { type:'redo' })
  assert.equal(state.present.clips[0].id, 'b')
  assert.deepEqual(subtractSpeech([one,two],'one',[{start:2,end:5},{start:4,end:6}]).map(({mediaId,start,end})=>[mediaId,start,end]),
    [['one',0,2],['one',6,8],['two',0,6]])
})

test('project round trip, recovery, missing source and fingerprint-verified relinking', async () => {
  const recovery = join(folder,'recovery.viralcut')
  const saved = join(folder,'manual.viralcut')
  const store = createProjectStore(recovery)
  const original = join(folder,'original.mp4')
  await writeFile(original, await readFile(a))
  const media = await store.register(original)
  const state = { ...base, media: [media], clips: [{ id:crypto.randomUUID(), mediaId:media.id, start:.2, end:1.1 }] }
  await store.save(saved,state)
  await store.autosave(state)
  assert.equal((await store.recovery()).available, true)
  assert.equal((await store.recover()).clips[0].start,.2)
  const relocated = join(folder,'relocated.mp4')
  await rename(original,relocated)
  const loaded = await store.open(saved)
  assert.ok(loaded.media[0].missing)
  assert.equal(loaded.clips[0].mediaId,loaded.media[0].id)
  await assert.rejects(store.relink(loaded.media[0].id,b))
  assert.equal((await store.relink(loaded.media[0].id,relocated)).missing,false)
  const broken = JSON.parse(await readFile(saved,'utf8'))
  broken.media[0].path = '\\\\remote\\test.mp4'
  assert.throws(()=>projectDocument(broken), /badProject/)
})

test('linked media is processed directly and survives job cleanup', async () => {
  const store = createProjectStore(join(folder, 'linked-recovery.viralcut'))
  const media = await store.register(a)
  const before = await readFile(a)
  const service = createExportService({ desktop: true, resolveMedia: store.resolveMedia })
  const server = createServer((request, response) => service.middleware(request, response, () => response.end(), server.address()))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = 'http://127.0.0.1:' + server.address().port + '/api/export'
  const signal = AbortSignal.timeout(10000)
  function request(path, options) {
    return fetch(url + path, { signal, ...options, headers: { 'x-viralcut': '2', ...options?.headers } })
  }
  try {
    const created = await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'silence', mediaId: media.id, analysis: { threshold: -38, minimum: .7 } }) })
    let job = await created.json()
    assert.equal(created.status, 201, JSON.stringify(job))
    while (job.phase === 'processing') {
      await new Promise(resolve => setTimeout(resolve, 80))
      job = await (await request('/' + job.id)).json()
    }
    assert.equal(job.phase, 'ready', JSON.stringify(job))
    assert.deepEqual((await (await request('/' + job.id + '/silence')).json()).silences, [])
    assert.equal((await request('/' + job.id, { method: 'DELETE' })).status, 200)
    assert.deepEqual(await readFile(a), before)
  } finally {
    await service.close()
    await new Promise(resolve => server.close(resolve))
  }
})

test('autosave preserves blank caption drafts and later saves preserve the newest edit', async () => {
  const store = createProjectStore(join(folder, 'draft.viralcut'))
  const media = await store.register(a)
  assert.equal((await store.register(a, true)).id, media.id)
  assert.ok(await store.protects(a))
  assert.equal(await store.protects(join(folder, 'new.mp4')), false)
  const draft = { ...base, media: [{ ...media, cues: [{ start: .2, end: 1, text: '' }] }] }
  const updated = { ...draft, media: [{ ...draft.media[0], cues: [{ start: .2, end: 1, text: 'Son değişiklik' }] }] }
  await store.autosave(draft)
  assert.equal((await store.recover()).media[0].cues[0].text, '')
  await Promise.all([store.autosave(draft), store.autosave(updated)])
  assert.equal((await store.recover()).media[0].cues[0].text, 'Son değişiklik')
})

test('mixed sources join in order with a frame-aligned audio boundary and Turkish burned captions', async t => {
  const store = createProjectStore(join(folder,'unused.viralcut'))
  const first = await store.register(b)
  const second = await store.register(a)
  const output = join(folder,'sequence.mp4')
  const frame = { mode:'vertical', zoom:1, x:0, y:0 }
  const settings = { profile, appearance, frame, encoder: 'auto', clips:[
    { mediaId:first.id,start:.2,end:1.2 },
    { mediaId:second.id,start:.3,end:1.3,cues:[{start:.35,end:1.25,text:'Türkçe test altyazısı'}] },
  ] }
  const job = validateSequence(settings,store.resolveMedia)
  const signal = AbortSignal.timeout(45000)
  const result = await encodeSequence({ ...job, directory:folder,output,signal,onProgress(){} })
  assert.ok((await stat(output)).size)
  assert.equal(result.verification.duration,2)
  assert.deepEqual([result.verification.width,result.verification.height],[720,1280])
  assert.equal(result.verification.fps,30)
  const color = ff('-i',output,'-an','-vf','crop=200:200:100:400,scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-')
  let blue = -1
  for(let i=0;i<color.length;i+=3) if(color[i+2]>180&&color[i]<50) { blue=i/90; break }
  const audio=ff('-i',output,'-vn','-ar','48000','-ac','1','-f','s16le','-')
  let tone=-1
  for(let i=0;i<audio.length;i+=2) if(Math.abs(audio.readInt16LE(i))>5000) { tone=i/96000;break }
  assert.ok(Math.abs(blue-tone)<.035, JSON.stringify({blue,tone}))
  assert.ok(Math.abs(blue-1)<.035)
  const pixels=ff('-ss','1.4','-i',output,'-frames:v','1','-vf','crop=600:160:60:1120','-f','rawvideo','-pix_fmt','gray','-')
  assert.ok(pixels.some(pixel=>pixel>205))
  t.diagnostic(JSON.stringify({ ...result.verification, videoBoundary:blue,audioBoundary:tone,encoder:result.encoder }))
  await assert.rejects(encodeSequence({...job, directory:folder, output, onProgress(){}, signal:AbortSignal.abort()}), { name:'AbortError' })
})
