import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { validateEffects, validateTransition } from '../server/effects.mjs'
import { encodeClip, probe } from '../server/media.mjs'
import { encodeSequence, validateSequence } from '../server/sequence.mjs'
import { validateBatchItem } from '../server/shorts-batch.mjs'
import { suggestZoom, zoomAt } from '../src/editor/effects.ts'

const ff = (...args) => execFileSync('ffmpeg', ['-v','error','-nostdin',...args], { windowsHide:true, maxBuffer:9e6 })
const profile = { resolution:720,fps:30,quality:'balanced',bitrate:0 }
const signal = AbortSignal.timeout(120000)
let folder, one, two
before(async () => {
  folder = await mkdtemp(join(tmpdir(),'viralcut-v9-test-'))
  one = join(folder,'blue.mp4'); two = join(folder,'red.mp4')
  ff('-f','lavfi','-i','color=blue:s=320x180:r=30','-f','lavfi','-i',
    "aevalsrc=0.2*sin(2*PI*440*t)*between(t\\,1\\,4)+0.015*sin(2*PI*5100*t):s=48000",
    '-vf','drawbox=x=105:y=45:w=120:h=90:c=white:t=fill','-t','4','-c:v','libx264','-c:a','aac',one)
  ff('-f','lavfi','-i','color=red:s=320x180:r=30','-f','lavfi','-i','sine=frequency=880:sample_rate=48000',
    '-t','4','-c:v','libx264','-c:a','aac',two)
})
after(async () => { if (folder) await rm(folder,{recursive:true,force:true}) })

test('effects and transitions reject invalid graph input and speech zoom needs suitable cues', () => {
  assert.throws(()=>validateEffects({brightness:'0,scale=1:1'}),/badEdit/)
  assert.throws(()=>validateTransition({kind:'fade;drawtext',duration:.5}),/badEdit/)
  const zoom=suggestZoom([{start:2,end:4,text:'Merhaba.'}],{start:0,end:5})
  assert.ok(Math.abs(zoomAt(zoom,3)-1.07)<1e-8)
  assert.equal(suggestZoom([],{start:0,end:5}),undefined)
  const clip=validateBatchItem({start:0,end:20,remove:[],frame:{mode:'vertical',zoom:1,x:0,y:0},effects:{noise:6,zoom},edgeFade:true},
    {resolution:720,encoder:'auto'})
  assert.equal(clip.edgeFade,.25)
  assert.equal(clip.effects.noise,6)
})

function rgb(path,time,filter='scale=1:1') {
  return ff('-ss',String(time),'-i',path,'-frames:v','1','-vf',filter,'-pix_fmt','rgb24','-f','rawvideo','-')
}

test('actual FFmpeg export applies zoom, grading and audio treatment without changing source', async t => {
  const original = await readFile(one)
  const output = join(folder,'processed.mp4')
  const effects = { zoom:{start:.2,end:2,from:1,to:1.6},brightness:.05,contrast:1.15,saturation:.5,sharpness:.2,
    voice:true,noise:10,normalize:true,fadeIn:.4,fadeOut:.4 }
  await encodeClip({input:one,output,format:'mp4',start:0,end:4,signal,onProgress(){},directory:folder,effects,
    edit:{remove:[],encoder:'cpu'}})
  const info=await probe(output,'mp4',signal)
  assert.ok(Math.abs(Number(info.format.duration)-4)<.09)
  const raw=rgb(one,.1,'crop=2:2:83:87'), first=rgb(output,.1,'crop=2:2:83:87'), last=rgb(output,2.5,'crop=2:2:83:87')
  assert.ok(first[0]>raw[0]+8 && last[0]>first[0]+65,JSON.stringify({raw:[...raw],first:[...first],last:[...last]}))
  function noise(file,start) {
    const pcm=ff('-ss',String(start),'-i',file,'-t','.25'.replace(/^\./,'0.'),'-vn','-ar','48000','-ac','1','-f','s16le','-')
    let squares=0
    for(let offset=0;offset<pcm.length;offset+=2) squares+=(pcm.readInt16LE(offset)/32768)**2
    return 10*Math.log10(squares/(pcm.length/2))
  }
  const rawDb=noise(one,.04), editedDb=noise(output,.04)
  assert.ok(editedDb<rawDb-2,`${rawDb}, ${editedDb}`)
  assert.deepEqual(await readFile(one),original)
  t.diagnostic(JSON.stringify({originalNoiseDb:rawDb,processedOpeningDb:editedDb}))
})

test('all three real transitions shorten the timeline equally and crossfade audio', async t => {
  for (const kind of ['fade','dissolve','slideleft']) {
    const output=join(folder,kind+'.mp4')
    const parts=[{path:one,format:'mp4',size:(await stat(one)).size},{path:two,format:'mp4',size:(await stat(two)).size}]
    const cut=validateSequence({ clips:[{mediaId:'a',start:0,end:4,transition:{kind,duration:.6}},
      {mediaId:'b',start:0,end:4}], profile,encoder:'auto' },id=>parts[id==='a'?0:1])
    const result=await encodeSequence({...cut,output,directory:folder,signal,onProgress(){}})
    assert.ok(Math.abs(result.verification.duration-7.4)<.09)
    const a=rgb(output,2), b=rgb(output,3.7), c=rgb(output,5)
    assert.ok(a[2]>a[0] && c[0]>c[2])
    assert.ok(kind==='fade'?Math.max(...b)<100:b[0]>25&&b[2]>25,`${kind}: ${[...b]}`)
    const audible = ff('-ss','3.66','-i',output,'-t','0.08','-vn','-ac','1','-ar','48000','-f','s16le','-')
    const power = hz => {
      let real=0, imaginary=0
      for(let i=0;i<audible.length/2;i++) {
        const phase=2*Math.PI*hz*i/48000, sample=audible.readInt16LE(i*2)
        real+=sample*Math.cos(phase); imaginary+=sample*Math.sin(phase)
      }
      return Math.hypot(real,imaginary)/(audible.length/2)
    }
    assert.ok(power(440)>100 && power(880)>100)
    t.diagnostic(JSON.stringify({kind,duration:result.verification.duration,center:[...b],encoder:result.encoder}))
  }
})

test('two caption tracks switch at the transition midpoint without stacking', async () => {
  const paths = await Promise.all([one, two].map(async path => ({ path, format: 'mp4', size: (await stat(path)).size })))
  const output = join(folder, 'caption-transition.mp4')
  const appearance = { font: 'arial', size: 64, style: 'bold', position: 'bottom', textColor: '#00ff00',
    highlight: false, highlightColor: '#00ff00', backgroundColor: '#151515', safe: true }
  const cues = (start, end, text) => [{ start, end, text }]
  const cut = validateSequence({ clips: [
    { mediaId: 'a', start: 0, end: 4, transition: { kind: 'dissolve', duration: .6 }, cues: cues(3.3, 4, 'WWWW') },
    { mediaId: 'b', start: 0, end: 4, cues: cues(0, 1, 'I') },
  ], profile, encoder: 'cpu', appearance }, id => paths[id === 'a' ? 0 : 1])
  await encodeSequence({ ...cut, output, directory: folder, signal, onProgress() {} })
  const green = time => {
    const pixels = rgb(output, time, 'scale=640:360')
    let count = 0
    for (let i = 0; i < pixels.length; i += 3) {
      if (pixels[i + 1] > 140 && pixels[i] < 100 && pixels[i + 2] < 100) count++
    }
    return count
  }
  const [outgoing, incoming, after] = [3.52, 3.86, 4.1].map(green)
  assert.ok(outgoing > incoming * 5 && incoming > 10 && Math.abs(after - incoming) < incoming * .35,
    JSON.stringify({ outgoing, incoming, after }))
})
