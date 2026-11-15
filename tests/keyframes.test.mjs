import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createProjectStore, projectDocument } from '../desktop/projects.mjs'
import { keyframeDocument, keyframeValue, curveValue, sliceAnimation } from '../server/keyframes.mjs'
import { validateLayeredSequence, encodeLayeredSequence } from '../server/layers.mjs'
import { emptyTrack, mediaClip, mergeLayerClip, putLayerClip, splitLayerClip } from '../src/project/layer-model.ts'
import { motionPresets, presetAnimation } from '../src/project/motion-presets.ts'
import { historyReducer } from '../src/project/model.ts'

const ff = (...args) => execFileSync(process.env.VIRALCUT_FFMPEG ?? 'ffmpeg', ['-v','error','-nostdin', ...args],
  { windowsHide:true, maxBuffer:10e6, timeout:45000 })
const profile = { resolution:720, fps:30, quality:'balanced', bitrate:0 }
const appearance = { style:'classic', font:'arial', position:'bottom', size:92, textColor:'#ffffff',
  highlightColor:'#b7fa70', backgroundColor:'#151515', highlight:false }
const points = (pairs, curve = 'linear', bezier) => pairs.map(([frame, value]) => ({ frame, value, curve, ...(bezier ? { bezier } : {}) }))

test('keyframe validation, exact boundary holds, cubic curves and split/trim preserve time', () => {
  const linear = points([[0,0],[60,1]])
  assert.equal(keyframeValue(linear, 30, 0),.5)
  assert.equal(keyframeValue(points([[0,0],[60,1]], 'hold'), 59, 0),0)
  assert.equal(keyframeValue(points([[0,0],[60,1]], 'hold'), 60, 0),1)
  assert.ok(curveValue(.5, 'ease-in') < .35)
  assert.ok(curveValue(.5, 'ease-out') > .65)
  assert.ok(Math.abs(curveValue(.5, 'ease-in-out') - .5) < .000001)
  const curve = points([[0,.2],[60,.8]], 'bezier', [.15,.35,.6,.9])
  const sliced = sliceAnimation({ x:curve }, 19, 35)
  for (let frame = 0; frame < 35; frame++) assert.ok(Math.abs(keyframeValue(sliced.x,frame,0) - keyframeValue(curve,frame+19,0)) < .000002)
  assert.throws(() => keyframeDocument({ x: points([[0,0],[0,.8]]) }, 'video', 70), /badTimeline/)
  assert.throws(() => keyframeDocument({ x: points([[70,.2]]) }, 'video', 70), /badTimeline/)
  assert.throws(() => keyframeDocument({ x: points([[0,.5]], 'bezier', [.2, 2, .9, 1]) }, 'video',70), /badTimeline/)
  assert.throws(() => keyframeDocument({ volume: linear }, 'video', 70), /badTimeline/)
  const clip = { ...mediaClip(crypto.randomUUID(), 'video', 10, 0, 70), animation:{ x:curve } }
  const track = { ...emptyTrack('video','V1'), clips:[clip] }
  const timeline = { fps:30, tracks:[track] }
  const split = splitLayerClip(timeline,track,clip,29)
  assert.equal(split.tracks[0].clips[1].animation.x[0].frame,0)
  assert.equal(split.tracks[0].clips[1].animation.x[0].value,keyframeValue(curve,19,0))
  const joined = mergeLayerClip(split, split.tracks[0], split.tracks[0].clips[0])
  for (let frame = 0; frame < clip.length; frame++) assert.ok(Math.abs(
    keyframeValue(joined.tracks[0].clips[0].animation.x, frame, 0) - keyframeValue(curve, frame, 0)) < .000002)
  const value = { version:3, timeline }
  const moved = putLayerClip(timeline, track.id, { ...clip, at:100 })
  let history = { previous:[], present:value, next:[] }
  history = historyReducer(history, { type:'update', apply:current => ({ ...current, timeline:moved }) })
  assert.equal(historyReducer(history,{type:'undo'}).present,value)
})

test('all 23 presets create editable, in-bounds channels with configured start and duration', () => {
  assert.equal(new Set(motionPresets.map(preset => preset.en)).size,23)
  for (const preset of motionPresets) {
    const kind = preset.parameter === 'reveal' ? 'text' : preset.parameter === 'volume' ? 'audio' : 'video'
    const base = preset.parameter === 'rotation' ? 0 : .5
    const animation = presetAnimation(preset,base,9,48,.75)
    const channel = keyframeDocument(animation,kind,60)[preset.parameter]
    assert.equal(channel[0].frame,9)
    assert.equal(channel.at(-1).frame,57)
    assert.ok(new Set(channel.map(point=>point.value)).size>=2,preset.en)
  }
})

test('v1/v2 project compatibility, v3 keyframes survive atomic save, recovery, and reopen', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'viralcut-v20-project-'))
  t.after(() => rm(folder, { recursive:true, force:true }))
  const store = createProjectStore(join(folder,'recovery.viralcut'))
  const base = { media:[], clips:[], profile, appearance, burn:true, encoder:'cpu' }
  const old = join(folder,'old.viralcut')
  await store.save(old,{ ...base,version:1 })
  assert.equal((await store.open(old)).version,1)
  const caption = { ...emptyTrack('caption','CC1'), clips:[{ id:crypto.randomUUID(), at:0, length:90, text:'Türkçe' }] }
  const timeline = { fps:30, tracks:[caption] }
  await store.save(old,{ ...base, version:2,timeline })
  const oldBytes = await readFile(old)
  assert.equal((await store.open(old)).version,2)
  caption.clips[0].animation = { reveal:points([[0,0],[40,1]]) }
  const updated = { ...base, version:3, timeline }
  const next = join(folder,'updated.viralcut')
  await store.save(next,updated)
  await store.autosave(updated)
  assert.deepEqual((await store.open(next)).timeline,timeline)
  assert.deepEqual((await store.recover()).timeline,timeline)
  assert.deepEqual(await readFile(old),oldBytes)
  assert.throws(() => projectDocument({ ...updated, version:2 }), /badProject/)
})

function sampleVideo(file, time) {
  const frame = Math.round(time * 30)
  const data = ff('-i',file,'-frames:v','1','-vf',`select=eq(n\\,${frame}),scale=160:90`,'-c:v','rawvideo','-threads','1','-pix_fmt','rgb24','-f','rawvideo','-')
  assert.equal(data.length,160*90*3)
  return data
}

function region(data, predicate) {
  let x=0, y=0, count=0, intensity=0
  for (let i=0;i<data.length;i+=3) {
    if (!predicate(data[i],data[i+1],data[i+2])) continue
    x += (i/3)%160; y += Math.floor(i/480); count++; intensity += data[i]
  }
  return { x:x/count, y:y/count, count, intensity:intensity/count }
}

function rms(file,time) {
  const data=ff('-ss',String(time),'-i',file,'-vn','-t','0.12','-ac','1','-ar','48000','-f','s16le','-')
  let squared=0
  for(let i=0;i<data.length;i+=2) squared+=data.readInt16LE(i)**2
  return Math.sqrt(squared/(data.length/2))
}

test('actual MP4 animates simultaneous PiP, rotation, scale, opacity, captions and gain; preview samples match', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'viralcut-v20-render-'))
  t.after(() => rm(folder, { recursive:true, force:true }))
  const make = (name, color, bars=false) => {
    const path=join(folder,name+'.mp4')
    ff('-f','lavfi','-i','color=c='+color+':s=480x270:r=30',
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-threads','2','-c:a','aac',
      ...(bars ? ['-vf','drawbox=x=160:y=75:w=50:h=100:color=lime:t=fill'] : []),path)
    return path
  }
  const store=createProjectStore(join(folder,'unused.viralcut'))
  const bg=await store.register(make('background','blue'))
  const pip=await store.register(make('pip','red',true))
  const a={...mediaClip(bg.id,'video',0,0,90),animation:{ opacity:points([[0,.9],[60,1]],'ease-out') }}
  const b={...mediaClip(pip.id,'video',0,0,90),scale:.3,y:0,animation:{
    x:points([[0,0],[60,1]],'bezier',[.42,0,.58,1]), scale:points([[0,.25],[60,.40]]),
    rotation:points([[0,0],[60,35]]),opacity:points([[0,.4],[60,1]]) }}
  const audio={...mediaClip(bg.id,'audio',0,0,90),animation:{ volume:points([[0,0],[30,0],[60,1]],'hold') }}
  const title={id:crypto.randomUUID(),at:0,length:90,text:'Türkçe KEYFRAME',animation:{
    x:points([[0,.24],[60,.65]]),y:points([[0,.75]]),reveal:points([[0,0],[12,0],[35,1]],'hold') }}
  const tracks=[['video',a],['video',b],['audio',audio],['text',title]].map(([kind,clip], index) => ({ ...emptyTrack(kind,kind+index), clips:[clip] }))
  const settings={timeline:{fps:30,tracks},profile,appearance,encoder:'auto'}
  async function render(name, config) {
    const output=join(folder,name+'.mp4')
    const start=performance.now()
    const result=await encodeLayeredSequence({ ...validateLayeredSequence(config,store.resolveMedia),
      directory:folder,output,signal:AbortSignal.timeout(90000),onProgress(){} })
    return { output, result, elapsed:performance.now()-start }
  }
  const full=await render('full',settings)
  assert.deepEqual([full.result.verification.width,full.result.verification.height,full.result.verification.fps],[1280,720,30])
  assert.equal(full.result.verification.duration,3)
  const red=(r,g,b)=>r>75&&r>g*1.6&&b<160
  const white=(r,g,b)=>r>105&&g>105&&b>140&&Math.abs(r-g)<25
  const green=(r,g,b)=>g>100&&g>r*1.5&&g>b
  const early=sampleVideo(full.output,.1), late=sampleVideo(full.output,2.2)
  const first=region(early,red), last=region(late,red)
  assert.ok(last.x-first.x>60,JSON.stringify({first,last}))
  assert.ok(last.count>first.count*1.3, JSON.stringify({first,last}))
  assert.ok(last.intensity>first.intensity+60)
  assert.ok(region(late,green).count>20)
  assert.equal(region(early,white).count,0)
  assert.ok(region(late,white).count>12, JSON.stringify(region(late,white)))
  assert.ok(rms(full.output,.25)<5 && rms(full.output,2.2)>1000)
  const preview=await render('preview',{...settings,preview:{from:36,to:78}})
  const at=1.6
  const previewPixels=sampleVideo(preview.output,.4)
  const fullPixels=sampleVideo(full.output,at)
  const match=region(fullPixels,red)
  const previewRed=region(previewPixels,red)
  assert.ok(Math.abs(previewRed.x-match.x)<1.5)
  const mae = fullPixels.reduce((sum,value,index) => sum + Math.abs(value-previewPixels[index]),0)/fullPixels.length
  t.diagnostic(JSON.stringify({previewRed, match, mae, previewWhite:region(previewPixels,white), fullWhite:region(fullPixels,white)}))
  assert.ok(Math.abs(previewRed.count-match.count)<match.count*.08)
  assert.ok(mae < 1, 'Mean absolute RGB error: ' + mae)
  assert.ok(Math.abs(region(previewPixels,white).x-region(fullPixels,white).x)<2)
  const cpu=await render('cpu',{...settings,encoder:'cpu',preview:{from:36,to:78}})
  assert.equal(cpu.result.encoder,'CPU')
  assert.ok(Math.abs(region(sampleVideo(cpu.output,.4),red).x-match.x)<1.5)
  t.diagnostic(JSON.stringify({ encoder:full.result.encoder,fullMs:Math.round(full.elapsed),previewMs:Math.round(preview.elapsed),first,last,
    earlyRms:rms(full.output,.25),lateRms:rms(full.output,2.2) }))
})

test('animated titles keep their local time across a 30 second render boundary', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'viralcut-v20-long-'))
  t.after(() => rm(folder, { recursive:true, force:true }))
  const clip={id:crypto.randomUUID(),at:0,length:960,text:'UZUN BAŞLIK',
    animation:{x:points([[0,.45],[959,.7]],'ease-in-out'),y:points([[0,.7]]),opacity:points([[0,.5],[959,1]])}}
  const tracks=[{...emptyTrack('text','T1'), clips:[clip]}]
  const work=validateLayeredSequence({ timeline:{fps:30,tracks},profile,appearance,encoder:'auto' },()=>null)
  assert.deepEqual(work.spans.map(({start,end})=>[start,end]),[[0,900],[900,960]])
  const output=join(folder,'long.mp4')
  const start=performance.now()
  const result=await encodeLayeredSequence({...work,output,directory:folder,signal:AbortSignal.timeout(120000),onProgress(){}})
  assert.equal(result.verification.duration,32)
  const mask=(r,g,b)=>r>110&&g>110&&b>110
  assert.ok(Math.abs(region(sampleVideo(output,29.9),mask).x-region(sampleVideo(output,30.1),mask).x)<2)
  t.diagnostic(JSON.stringify({ elapsedMs:Math.round(performance.now()-start), encoder:result.encoder, duration:32,frames:960 }))
})
