import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { directions,effectDocument,effects,maxEffects,transitionDocument,transitions } from '../../server/effect-document.mjs'
import type { ClipEffect, ClipTransition } from '../../server/effect-document.mjs'
import { curves,keyframeValue } from '../../server/keyframes.mjs'
import type { Bezier,Curve,Keyframe } from '../../server/keyframes.mjs'
import { effectPreset,importPreset,presetGroups } from './effect-presets'
import type { TimelineClip } from './layer-model'

import type { EffectsLibrary } from '../../server/effect-document.mjs'

function NumberField({label,value,min,max,set,step=1}:{label:string;value:number;min:number;max:number;set:(v:number)=>void;step?:number}) {
  return <label>{label}<input key={label+value} type="number" min={min} max={max} step={step} defaultValue={value}
    onBlur={event=>{const v=event.currentTarget.valueAsNumber;if(Number.isFinite(v)&&v>=min&&v<=max&&v!==value)set(v)}}
    onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/></label>
}

export function EffectsStudio({clip,fps,at,tr,locked,adjacent,apply,clipboard,libraryHost}:{clip:TimelineClip;fps:number;at:number;tr:boolean;locked:boolean;adjacent:boolean;
  apply:(clip:TimelineClip)=>boolean;clipboard:React.RefObject<string>;libraryHost?:HTMLDivElement|null}) {
  const t=(turkish:string,english:string)=>tr?turkish:english
  const [lib,setLib]=useState<EffectsLibrary>({names:{},favorites:[]})
  useEffect(()=>{let alive=true;void window.viralCutDesktop?.effectsLibrary.read().then(value=>{if(alive&&value?.names)setLib(value)}).catch(()=>{});return()=>{alive=false}},[])
  const [query,setQuery]=useState('')
  const [group,setGroup]=useState('all')
  const [preset,setPreset]=useState('')
  const [position,select]=useState(0)
  const [notice,setNotice]=useState('')
  const [json,setJson]=useState('')
  const [name,setName]=useState('')
  const importFile=useRef<HTMLInputElement>(null)
  const stack=clip.effects??[]
  const current=stack[position]
  const frame=current?Math.max(0,Math.min(current.end-current.start-1,at-clip.at-current.start)):0
  const point=current?.keys?.find(point=>point.frame===frame)
  const incoming=clip.incoming
  const clipJSON=()=>JSON.stringify({version:1,length:clip.length,effects:stack},null,2)
  function persist(value:EffectsLibrary) {
    setLib(value)
    void window.viralCutDesktop?.effectsLibrary.save(value).then(ok=>{
      if(ok!==true)setNotice(t('Ön ayar kaydedilemedi.','Unable to save preset.'))
    }).catch(()=>setNotice(t('Ön ayar kaydedilemedi.','Unable to save preset.')))
  }
  function submit(next:TimelineClip) {
    if(locked)return
    try{
      next.effects=effectDocument(next.effects,next.length)
      next.incoming=transitionDocument(next.incoming,next.length,fps)
      if(!apply(next))throw Error('badEffects')
      setNotice('')
    }catch{setNotice(t('Efekt süresi veya değeri geçersiz.','The effect range or value is invalid.'))}
  }
  const setStack=(effects:ClipEffect[])=>submit({...clip,effects})
  function edit(entry:ClipEffect) {setStack(stack.map((e,i)=>i===position?entry:e))}
  function selectedKey(value:number,curve:Curve,bezier?:Bezier) {
    if(!current)return
    const next:Keyframe={frame,value,curve,...(curve==='bezier'?{bezier:bezier??[.42,0,.58,1]}:{})}
    edit({...current,keys:[...(current.keys??[]).filter(p=>p.frame!==frame),next].sort((a,b)=>a.frame-b.frame)})
  }
  function importText(text:string) {
    try {const data=importPreset(text,clip.length);setStack(data);select(0)}
    catch {setNotice(t('Ön ayar JSON dosyası geçersiz.','Invalid preset JSON.'))}
  }
  function move(delta:number) {
    const next=[...stack]
    const target=position+delta
    if(!current||target<0||target>=stack.length)return
    next.splice(position,1);next.splice(target,0,current);setStack(next);select(target)
  }
  function updateTransition(patch:Partial<ClipTransition>) {
    if(incoming) submit({...clip,incoming:{...incoming,...patch}})
  }
  const library=<div className="effects-library">
    <label>{t('Efekt ara','Search effects')}<input value={query} onChange={event=>setQuery(event.target.value)} /></label>
    <label>{t('Kategori','Category')}<select value={group} onChange={event=>setGroup(event.target.value)}>
      <option value="all">{t('Tümü','All')}</option><option value="visual">{t('Görsel','Visual')}</option>
      <option value="motion">{t('Hareket','Motion')}</option><option value="style">{t('Stil','Style')}</option>
      <option value="favorites">{t('Favoriler','Favorites')}</option>
    </select></label>
    <div className="effect-results">
      {effects.filter(([id,category,en,tk])=>(group==='all'||group===category||group==='favorites'&&lib.favorites.includes(id))&&
        [en,tk].some(name=>name.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
        .map(([id,,en,tk])=><div key={id}>
          <button type="button" disabled={locked||stack.length>=maxEffects} onClick={()=>{
            setStack([...stack,{id,enabled:true,amount:.75,detail:.45,start:0,end:clip.length}]);select(stack.length)
          }}>+ {tr?tk:en}</button>
          <button type="button" aria-label={(tr?'Favori ':'Favorite ')+(tr?tk:en)} aria-pressed={lib.favorites.includes(id)}
            onClick={()=>persist({...lib,favorites:lib.favorites.includes(id)?lib.favorites.filter(saved=>saved!==id):[...lib.favorites,id]})}>★</button>
        </div>)}
    </div>
    <label>{t('Efekt ön ayarı','Effect preset')}<select value={preset} onChange={event=>setPreset(event.target.value)}>
      <option value="">{t('Bir paket seç','Choose a pack')}</option>
      {presetGroups.map(([group,items])=><optgroup key={group} label={group}>{items.map(([id,label])=><option key={id} value={id}>{label}</option>)}</optgroup>)}
      <optgroup label={t('Özel','Custom')}>{Object.keys(lib.names).map(name=><option key={name} value={'custom:'+name}>{name}</option>)}</optgroup>
    </select></label>
    <button type="button" disabled={locked||!preset} onClick={()=>{if(preset.startsWith('custom:'))importText(lib.names[preset.slice(7)]);else setStack(effectPreset(preset,clip.length));select(0)}}>
      {t('Paketi zincir olarak uygula','Replace stack with pack')}</button>
  </div>
  return <section className="panel keyframe-studio effects-studio" aria-label={t('Efekt stüdyosu','Effects Studio')}>
    <header className="panel-header"><h2>{t('Efekt stüdyosu','Effects Studio')}</h2><span>{stack.length}/{maxEffects}</span></header>
    <div className="keyframe-body">
      {libraryHost ? createPortal(library,libraryHost) : <details><summary>{t('Kütüphane','Library')}</summary>{library}</details>}
      <fieldset disabled={locked}>
        <legend>{t('Efekt zinciri','Effect stack')}</legend>
        {stack.map((entry,index)=><div className="effect-row" key={index}>
          <button type="button" aria-pressed={position===index} onClick={()=>select(index)}>
            {effects.find(e=>e[0]===entry.id)?.[tr?3:2]}</button>
          <label><input type="checkbox" checked={entry.enabled} onChange={event=>setStack(stack.map((e,i)=>i===index?{...e,enabled:event.target.checked}:e))}/>
            {t('Etkin','Enabled')}</label>
        </div>)}
        {current&&<>
          <div className="layer-tools">
            <button type="button" disabled={!position} onClick={()=>move(-1)}>{t('Yukarı','Up')}</button>
            <button type="button" disabled={position>=stack.length-1} onClick={()=>move(1)}>{t('Aşağı','Down')}</button>
            <button type="button" onClick={()=>{setStack(stack.filter((_,i)=>i!==position));select(Math.max(0,position-1))}}>{t('Efekti sil','Remove effect')}</button>
            <button type="button" onClick={()=>edit({...current,amount:.75,detail:.45,keys:undefined})}>{t('Sıfırla','Reset')}</button>
          </div>
          <NumberField label={t('Yoğunluk %','Strength %')} value={Math.round(current.amount*100)} min={0} max={100} set={v=>edit({...current,amount:v/100})}/>
          <NumberField label={t('Efekt ayrıntısı %','Effect detail %')} value={Math.round(current.detail*100)} min={0} max={100} set={v=>edit({...current,detail:v/100})}/>
          <div className="layer-properties-grid">
            <NumberField label={t('Başlangıç karesi','Start frame')} value={current.start} min={0} max={current.end-1} set={v=>edit({...current,start:v})}/>
            <NumberField label={t('Bitiş karesi','End frame')} value={current.end} min={current.start+1} max={clip.length} set={v=>edit({...current,end:v})}/>
          </div>
          <div className="layer-tools">
            <button type="button" disabled={!!point || (current.keys?.length??0)>=32} onClick={()=>selectedKey(keyframeValue(current.keys,frame,current.amount),'linear')}>
              + {t('Yoğunluk karesi','Strength keyframe')} ({frame})</button>
            {!!point&&<button type="button" onClick={()=>edit({...current,keys:current.keys!.length===1?undefined:current.keys!.filter(p=>p.frame!==frame)})}>{t('Kareyi sil','Delete keyframe')}</button>}
          </div>
          {point&&<>
            <NumberField label={t('Kare yoğunluğu %','Keyframe strength %')} value={Math.round(point.value*100)} min={0} max={100} set={v=>selectedKey(v/100,point.curve,point.bezier)}/>
            <label>{t('Efekt eğrisi','Effect easing')}<select value={point.curve} onChange={event=>selectedKey(point.value,event.target.value as Curve,point.bezier)}>
              {curves.map(curve=><option key={curve}>{curve}</option>)}
            </select></label>
            {point.curve==='bezier'&&<div className="layer-properties-grid">{point.bezier!.map((value,index)=><NumberField key={index} label={['X1','Y1','X2','Y2'][index]}
              value={value} min={0} max={1} step={.01} set={v=>{const next:Bezier=[...point.bezier!];next[index]=v;selectedKey(point.value,'bezier',next)}}/>)}</div>}
          </>}
        </>}
      </fieldset>
      <fieldset disabled={locked}>
        <legend>{t('Giriş geçişi','Incoming transition')}</legend>
        {!adjacent&&<small>{t('Aynı izde boşluksuz bir önceki klip gerekir.','Requires an adjacent preceding clip on the same track.')}</small>}
        <label>{t('Geçiş türü','Transition type')}<select disabled={!adjacent||clip.length<2} value={incoming?.id??''} onChange={event=>{
          const id=event.target.value
          submit({...clip,incoming:id?incoming?{...incoming,id}:{id,start:0,length:Math.min(clip.length,Math.round(fps*.4)),direction:'left',amount:.65}:undefined})
        }}><option value="">{t('Yok','None')}</option>
          {transitions.map(([id,en,tk])=><option key={id} value={id}>{tr?tk:en}</option>)}</select></label>
        {incoming&&<>
          <label>{t('Yön','Direction')}<select value={incoming.direction} onChange={event=>updateTransition({direction:event.target.value})}>
            {directions.map((direction,i)=><option key={direction} value={direction}>{tr?['Sol','Sağ','Yukarı','Aşağı'][i]:direction}</option>)}
          </select></label>
          <div className="layer-properties-grid">
            <NumberField label={t('Klipte başlangıç','Clip offset')} value={incoming.start} min={0} max={clip.length-incoming.length} set={start=>updateTransition({start})}/>
            <NumberField label={t('Süre · kare','Duration · frames')} value={incoming.length} min={2} max={Math.min(fps*4,clip.length-incoming.start)} set={length=>updateTransition({length})}/>
          </div>
          <NumberField label={t('Geçiş şiddeti %','Transition strength %')} value={Math.round(incoming.amount*100)} min={0} max={100} set={v=>updateTransition({amount:v/100})}/>
        </>}
      </fieldset>
      <details><summary>{t('Özel ön ayar ve JSON','Custom preset and JSON')}</summary>
        <div className="keyframe-body">
          <div className="layer-tools">
            <button type="button" disabled={!stack.length} onClick={()=>{clipboard.current=clipJSON();setNotice(t('Zincir kopyalandı.','Stack copied.'))}}>{t('Zinciri kopyala','Copy stack')}</button>
            <button type="button" disabled={locked} onClick={()=>importText(clipboard.current)}>{t('Zinciri yapıştır','Paste stack')}</button>
          </div>
          <label>{t('Ön ayar adı','Preset name')}<input maxLength={45} value={name} onChange={event=>setName(event.target.value)}/></label>
          <button type="button" disabled={!name.trim()||!stack.length||Object.keys(lib.names).length>=16&&!Object.hasOwn(lib.names,name.trim())}
            onClick={()=>persist({...lib,names:{...lib.names,[name.trim()]:clipJSON()}})}>{t('Ön ayarı kaydet','Save preset')}</button>
          <button type="button" disabled={!stack.length} onClick={()=>{
            const url=URL.createObjectURL(new Blob([clipJSON()],{type:'application/json'}))
            const link=document.createElement('a');link.href=url;link.download='ViralCut-effects.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
          }}>{t('JSON indir','Download JSON')}</button>
          <input ref={importFile} type="file" accept="application/json,.json" hidden onChange={async event=>{
            const input=event.currentTarget,file=input.files?.[0];input.value=''
            if(file&&file.size<=100000) {try {importText(await file.text())} catch {setNotice(t('Dosya okunamadı.','Unable to read file.'))}}
          }}/>
          <button type="button" disabled={locked} onClick={()=>importFile.current?.click()}>{t('JSON dosyası aç','Open JSON file')}</button>
          <textarea aria-label="JSON" maxLength={100000} value={json} onChange={event=>setJson(event.target.value)}/>
          <button type="button" disabled={locked||!json} onClick={()=>importText(json)}>{t('JSON uygula','Apply JSON')}</button>
        </div>
      </details>
      <small>{t('Sonucu birleşik önizlemede gör.','See the result in composite preview.')}</small>
      {notice&&<p role="status">{notice}</p>}
    </div>
  </section>
}
