import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { recommendShorts, safePauses } from '../src/editor/autoShorts.ts'
import { analyzeSilence } from '../server/shorts.mjs'
import { createExportService } from '../server/export.mjs'
import { probe } from '../server/media.mjs'

let folder, source
const signal = AbortSignal.timeout(120000)
const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', ...args], { windowsHide: true, maxBuffer: 8e6 })
const appearance = { style:'classic', font:'arial', size:52, position:'bottom', textColor:'#ffffff',
  highlightColor:'#b7fa70', backgroundColor:'#151515', highlight:true }
const frame = { mode:'vertical', zoom:1, x:0, y:0 }

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'viralcut-v7-test-'))
  const path = join(folder, 'markers.mp4')
  ff('-f','lavfi','-i','color=blue:s=320x180:r=30','-f','lavfi','-i',
    "aevalsrc=0.5*sin(2*PI*440*t)*(lt(mod(t\\,24)\\,8)+gte(mod(t\\,24)\\,11)):s=48000",
    '-vf',"drawbox=c=red:t=fill:enable='gte(mod(t,24),11)'",'-t','72','-c:v','libx264','-threads','2','-c:a','aac',path)
  source = { path, size:(await stat(path)).size, format:'mp4' }
})
after(async () => { if (folder) await rm(folder,{ recursive:true,force:true }) })

test('recommendations use full sentence windows, reject similar speech and preserve protected pauses', () => {
  const groups = ['Bugün bahçedeki domatesleri ektik.', 'Bugün bahçedeki domatesleri ektik.',
    'Bir teleskopla Ay yüzeyindeki kraterleri saydım.', 'Kütüphaneden tarih atlası ve haritalar aldım.']
  const cues = groups.map((text,index) => ({ start:index*24+.4, end:index*24+19, text }))
  const suggested = recommendShorts(cues, [], 96)
  assert.equal(suggested.length,3)
  assert.deepEqual(suggested.map(item=>item.id),[0,2,3])
  assert.ok(suggested.every(item=>item.end-item.start>=15 && item.end-item.start<=60 && item.boundaries===6))
  assert.deepEqual(safePauses({start:0,end:20},[{start:3,end:9}], [{start:5,end:7,text:'protected'}],.25),
    [{start:3.25,end:4.75},{start:7.25,end:8.75}])
})

test('three silent-cut portrait MP4s, A/V and captions, isolated failure, cancellation and retry', async t => {
  const analyzer = await analyzeSilence({ input:source.path, format:source.format, signal, analysis:{threshold:-38, minimum:.55}, onProgress(){} })
  assert.equal(analyzer.silences.length,3)
  const original = await readFile(source.path)
  const service = createExportService({ desktop:true, resolveMedia:id=>id==='local'?source:null })
  const request = { mediaId:'local', resolution:720, encoder:'auto', items:[0,24,48].map(start => {
    const range = { start, end:start+21 }
    const cues = [{start:start+11.25,end:start+15,text:'Türkçe eşzaman testi.'}]
    return { ...range, frame, remove:safePauses(range, analyzer.silences,cues,.18), overlay:{ appearance,cues } }
  }) }
  async function finish() {
    let answer = service.batchStatus()
    while (answer.active) {
      signal.throwIfAborted()
      await new Promise(resolve=>setTimeout(resolve,120))
      answer = service.batchStatus()
    }
    return answer.items
  }
  try {
    await service.startBatch(request,folder)
    const outputs = await finish()
    assert.deepEqual(outputs.map(item=>item.phase), ['ready','ready','ready'], JSON.stringify(outputs))
    assert.equal(new Set(outputs.map(item=>item.filename)).size,3)
    for (const item of outputs) {
      const video = join(folder,item.filename)
      const info = await probe(video,'mp4',signal)
      assert.equal(Number(info.format.duration) > 18 && Number(info.format.duration) < 18.6,true)
      assert.equal(item.verification.captions,true)
      assert.deepEqual(info.streams.map(stream=>stream.codec_name),['h264','aac'])
      assert.deepEqual([info.streams[0].width,info.streams[0].height],[720,1280])
    }
    const first = join(folder,outputs[0].filename)
    const frames = ff('-i',first,'-an','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-')
    const audio = ff('-i',first,'-vn','-ar','48000','-ac','1','-f','s16le','-')
    let videoOnset, audioOnset
    for (let byte=0; byte<frames.length; byte+=3) if (frames[byte]>175 && frames[byte+2]<65) { videoOnset=byte/90; break }
    for (let byte=Math.round(8.2*48000)*2; byte<audio.length; byte+=2) if (Math.abs(audio.readInt16LE(byte))>6000) { audioOnset=byte/96000; break }
    assert.ok(Math.abs(videoOnset-audioOnset)<.065, JSON.stringify({videoOnset,audioOnset}))
    const captionPixels = ff('-ss','10','-i',first,'-frames:v','1','-vf','crop=600:150:60:1110','-f','rawvideo','-pix_fmt','gray','-')
    assert.ok(captionPixels.some(pixel=>pixel>200))
    t.diagnostic(JSON.stringify({ videoOnset,audioOnset,count:outputs.length,encoders:outputs.map(item=>item.encoder) }))
    await service.startBatch({...request,items:[{...request.items[0],end:9},request.items[1]]},folder)
    assert.deepEqual((await finish()).map(item=>item.phase),['failed','ready'])
    await service.startBatch(request,folder)
    service.cancelBatch()
    assert.ok((await finish()).every(item=>item.phase==='cancelled'))
    await service.startBatch({...request,items:[request.items[0]], encoder:'cpu'},folder)
    assert.equal((await finish())[0].encoder,'CPU')
    assert.equal((await readdir(folder)).filter(name=>name.endsWith('.mp4')).length,6)
    assert.deepEqual(await readFile(source.path), original)
  } finally { await service.close() }
})
