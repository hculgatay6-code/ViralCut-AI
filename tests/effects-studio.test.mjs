import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp,readFile,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { effects,effectDocument,libraryDocument,transitions } from '../server/effect-document.mjs'
import { effectFilters } from '../server/effect-render.mjs'
import { encodeLayeredSequence,validateLayeredSequence } from '../server/layers.mjs'
import { createProjectStore } from '../desktop/projects.mjs'
import { emptyTrack,mediaClip,putLayerClip,splitLayerClip } from '../src/project/layer-model.ts'

import { effectPreset,importPreset,presetGroups } from '../src/project/effect-presets.ts'
import { historyReducer } from '../src/project/model.ts'
import { parseCopilot,projectEdit,validateSteps } from '../src/editor/copilotPlan.ts'

const ff = (...args) => execFileSync(process.env.VIRALCUT_FFMPEG ?? 'ffmpeg',['-v','error','-nostdin',...args],{ windowsHide:true,maxBuffer:8e6,timeout:90000 })
const effect = (id, amount=1, end=60) => ({id,amount,enabled:true,detail:.6,start:0,end})
test('all catalog effects run in FFmpeg and change pixels on a controlled pattern', () => {
  const pattern='testsrc2=s=192x108:r=30:d=0.2'
  const base=ff('-f','lavfi','-i',pattern,'-vf','select=eq(n\\,3)','-frames:v','1','-c:v','rawvideo','-threads','1','-pix_fmt','yuv420p','-f','rawvideo','-')
  for (const [id] of effects) {
    const {filters,current}=effectFilters([effect(id,1,6)],'v0',192,108,30,0,6)
    const graph=['[0:v]format=yuv420p,setsar=1[v0base]',...filters,`[${current}]select=eq(n\\,3)[out]`].join(';')
    const output=ff('-f','lavfi','-i',pattern,'-filter_complex_threads','2','-filter_complex',graph,
      '-map','[out]','-frames:v','1','-c:v','rawvideo','-threads','1','-pix_fmt','yuv420p','-f','rawvideo','-')
    assert.equal(output.length,base.length,id)
    assert.ok(output.some((value,index)=>value!==base[index]),id)
  }
  assert.throws(()=>effectDocument([{...effect('blur'),detail:Infinity}],60))
  assert.throws(()=>effectDocument([{...effect('lut=unsafe')}],60))
})

const profile={resolution:720,fps:30,bitrate:0,quality:'balanced'}
const appearance={style:'classic',font:'arial',position:'bottom',size:52,textColor:'#ffffff',highlightColor:'#b7fa70',backgroundColor:'#151515',highlight:false}
async function fixture(t) {
  const folder=await mkdtemp(join(tmpdir(),'viralcut-v21-'))
  t.after(()=>rm(folder,{recursive:true,force:true}))
  const store=createProjectStore(join(folder,'recovery.viralcut'))
  async function add(name,video) {
    const path=join(folder,name+'.mp4')
    ff('-f','lavfi','-i',video,'-f','lavfi','-i','sine=frequency=440','-t','2','-c:v','libx264','-threads','2','-c:a','aac',path)
    return store.register(path)
  }
  const red=await add('red','color=red:s=320x180:r=30'), blue=await add('blue','color=blue:s=320x180:r=30')
  const bars=await add('bars','testsrc2=s=320x180:r=30')
  let sequence=0
  async function render(tracks, preview, resolution=720) {
    const output=join(folder,'output'+(++sequence)+'.mp4')
    const settings={ timeline:{fps:30,tracks},appearance,profile:{...profile,resolution},encoder:'auto',preview }
    const start=performance.now()
    const meta=await encodeLayeredSequence({...validateLayeredSequence(settings,store.resolveMedia),
      directory:folder,output,signal:AbortSignal.timeout(120000),onProgress(){}})
    return {output,meta,ms:performance.now()-start}
  }
  return {store,folder,red,blue,bars,render}
}

function pixels(file, frame, crop) {
  return ff('-i',file,'-vf',`select=eq(n\\,${frame}),${crop?'crop='+crop+',':''}scale=160:90`,'-frames:v','1','-c:v','rawvideo',
    '-threads','1','-pix_fmt','rgb24','-f','rawvideo','-')
}
function difference(a,b) {
  assert.equal(a.length,b.length)
  return a.reduce((total,v,i)=>total+Math.abs(v-b[i]),0)/a.length
}

test('ordered five-effect 1080p export uses cubic intensity keys and matches a clipped preview',async t=>{
  const {bars,render}=await fixture(t)
  const clip=mediaClip(bars.id,'video',0,0,60)
  const keyed={...effect('mono'),keys:[{frame:0,value:0,curve:'bezier',bezier:[.42,0,.58,1]},{frame:30,value:1,curve:'hold'}]}
  const stack=[effect('blur',.24),effect('glow',.4),effect('grain',.23),effect('vignette',.55),keyed]
  const track={...emptyTrack('video','V1'),clips:[{...clip,effects:stack}]}
  const audio={...emptyTrack('audio','A1'),clips:[mediaClip(bars.id,'audio',0,0,60)]}
  const full=await render([track,audio],undefined,1080)
  const preview=await render([track,audio],{from:21,to:40},1080)
  const reordered=await render([{...track,clips:[{...clip,effects:[keyed,...stack.slice(0,4)]}]},audio],{from:21,to:40},1080)
  const noAnimation=await render([{...track,clips:[{...clip,effects:stack.slice(0,4)}]},audio],{from:21,to:40},1080)
  const mean=difference(pixels(full.output,28),pixels(preview.output,7))
  assert.ok(mean<2,'Preview RGB MAE '+mean)
  assert.ok(difference(pixels(preview.output,7),pixels(noAnimation.output,7))>5,'Intensity changes real pixels')
  assert.ok(difference(pixels(preview.output,7),pixels(reordered.output,7))>.1,'Stack ordering changes the output')
  assert.equal(full.meta.verification.duration,2)
  assert.equal(full.meta.verification.width,1920)
  const audioData=ff('-i',full.output,'-map','0:a:0','-ar','48000','-ac','1','-f','s16le','-')
  assert.ok(audioData.some(value=>value>40))
  assert.ok(Math.abs(audioData.length/96000-2)<.04)
  t.diagnostic(JSON.stringify({mean,fullMs:Math.round(full.ms),previewMs:Math.round(preview.ms),encoder:full.meta.encoder}))
})

test('all transitions preserve the edit duration, lower layer and audio, with repeatable preview frames',async t=>{
  const {red,blue,bars,render}=await fixture(t)
  const under={...emptyTrack('video','V1'),clips:[mediaClip(bars.id,'video',0,0,60)]}
  const track={...emptyTrack('video','V2'),clips:[{...mediaClip(red.id,'video',0,0,30),scale:.55},
    {...mediaClip(blue.id,'video',30,0,30),scale:.55}]}
  const audio={...emptyTrack('audio','A1'),clips:[mediaClip(bars.id,'audio',0,0,60)]}
  let dissolve
  for (const [id] of transitions) {
    const incoming={id,amount:.85,direction:'left',start:0,length:12}
    const configured={...track,clips:[track.clips[0],{...track.clips[1],incoming}]}
    const result=await render([under,configured,audio],id==='dissolve'?undefined:{from:28,to:45})
    const base=id==='dissolve'?0:28
    assert.ok(difference(pixels(result.output,30-base),pixels(result.output,36-base))>4,id)
    assert.ok(difference(pixels(result.output,36-base),pixels(result.output,43-base))>4,id)
    if (id==='dissolve') {
      dissolve=result
      const preview=await render([under,configured,audio],{from:34,to:42})
      const mean=difference(pixels(result.output,37),pixels(preview.output,3))
      assert.ok(mean<2,String(mean))
      const edge=()=>pixels(result.output,35,'200:140:0:0')
      assert.ok(difference(edge(),pixels(result.output,36,'200:140:0:0'))<4)
      t.diagnostic(JSON.stringify({transitionPreviewError:mean,previewMs:Math.round(preview.ms)}))
    }
  }
  assert.equal(dissolve.meta.verification.duration,2)
  const pcm=ff('-i',dissolve.output,'-map','0:a:0','-ar','48000','-ac','1','-f','s16le','-')
  assert.ok(Math.abs(pcm.length/96000-2)<.04)
  assert.ok(pcm.subarray(48000*2,48000*2+9000).some(value=>value>40))
})

test('35 preset recipes, strict JSON, v3 to v4 save and recovery, edits and Copilot maintain the project',async t=>{
  const {store,folder,bars}=await fixture(t)
  const recipes=presetGroups.flatMap(([,items])=>items)
  assert.equal(recipes.length,35)
  for(const [id] of recipes) assert.equal(effectDocument(effectPreset(id,60),60).length,2)
  const clip=mediaClip(bars.id,'video',0,0,60)
  const track={...emptyTrack('video','V1'),clips:[clip]}
  const legacy={version:3,profile,appearance,encoder:'cpu',burn:true,media:[bars],clips:[],timeline:{fps:30,tracks:[track]}}
  const original=join(folder,'v20.viralcut'), candidate=join(folder,'v21.viralcut')
  await store.save(original,legacy)
  const before=await readFile(original)
  const plan=parseCopilot('Bu videoya sinematik efekt uygula.')
  assert.deepEqual(plan.steps,[{tool:'layerLook',preset:'cinematic'}])
  assert.deepEqual(parseCopilot('Add an RGB effect for this gaming clip').steps,[{tool:'layerLook',preset:'gaming'}])
  assert.deepEqual(parseCopilot('Bu klibe yumuşak geçiş koy').steps,[{tool:'layerLook',preset:'dissolve'}])
  assert.deepEqual(parseCopilot('Videoyu eski film gibi göster').steps,[{tool:'layerLook',preset:'oldfilm'}])
  assert.deepEqual(parseCopilot('Hareketli sahnelere uygun efekt öner').steps,[{tool:'layerLook',preset:'action'}])
  assert.throws(()=>validateSteps([{tool:'layerLook',preset:'unknown'}]),/plan/)
  assert.throws(()=>projectEdit(legacy,plan.steps[0],'',''),/effectSelection/)
  const v4=projectEdit(legacy,plan.steps[0],'',clip.id)
  assert.equal(v4.version,4)
  assert.deepEqual(v4.timeline.tracks[0].clips[0].effects,effectPreset('cinematic',60))
  assert.equal(projectEdit(v4,{tool:'layerLook',preset:'action'},'',clip.id),v4)
  const originalTrack=v4.timeline.tracks[0], applied=originalTrack.clips[0]
  const edited={...applied,effects:[{...applied.effects[1],enabled:false},{...applied.effects[0],start:10,end:50,
    keys:[{frame:0,value:.25,curve:'linear'},{frame:30,value:1,curve:'hold'}]}]}
  const timeline=putLayerClip(v4.timeline,track.id,edited)
  let history=historyReducer({previous:[],present:v4,next:[]},{type:'update',apply:project=>({...project,timeline})})
  history=historyReducer(history,{type:'undo'})
  assert.equal(history.present,v4)
  history=historyReducer(history,{type:'redo'})
  assert.equal(history.present.timeline,timeline)
  const split=splitLayerClip(timeline,timeline.tracks[0],edited,30)
  assert.equal(split.tracks[0].clips[1].effects[1].start,0)
  assert.ok(split.tracks[0].clips[1].effects[1].keys[0].value>.5)
  const json=JSON.stringify({version:1,length:60,effects:edited.effects})
  assert.ok(libraryDocument({names:{Demo:json},favorites:['blur']}).names.Demo)
  assert.equal(importPreset(json,30)[1].end,25)
  assert.throws(()=>libraryDocument({names:{Demo:json},favorites:['unknown']}),/badEffects/)
  assert.throws(()=>importPreset(JSON.stringify({version:1,length:60,effects:[effect('invalid')]}),30),/badEffects/)
  await store.save(candidate,history.present)
  await store.autosave(history.present)
  assert.deepEqual((await store.recover()).timeline.tracks[0].clips[0].effects,edited.effects)
  assert.deepEqual((await store.open(candidate)).timeline.tracks[0].clips[0].effects,edited.effects)
  assert.equal((await store.open(original)).version,3)
  assert.deepEqual(await readFile(original),before)
})

test('a moved transition holds the outgoing shot through its new start in both export and preview',async t=>{
  const {red,blue,render}=await fixture(t)
  const first=mediaClip(red.id,'video',0,0,30)
  const next={...mediaClip(blue.id,'video',30,0,30),incoming:{id:'dissolve',direction:'left',amount:.5,start:8,length:12}}
  const timeline=[{...emptyTrack('video','V1'),clips:[first,next]}]
  const full=await render(timeline)
  const preview=await render(timeline,{from:32,to:48})
  assert.ok(difference(pixels(full.output,20),pixels(full.output,34))<2)
  assert.ok(difference(pixels(full.output,34),pixels(preview.output,2))<2)
  assert.ok(difference(pixels(full.output,34),pixels(full.output,52))>80)
  assert.equal(full.meta.verification.duration,2)
})
