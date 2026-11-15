import { useState, useRef } from 'react'
import type { PointerEvent, RefObject } from 'react'
import { bezierPresets, curves, curveValue, keyframeBounds, keyframeDocument, keyframeLimits, keyframeValue, parametersByKind } from '../../server/keyframes.mjs'
import type { Animation, Bezier, Curve, Keyframe, Parameter } from '../../server/keyframes.mjs'
import { motionPresets, presetAnimation } from './motion-presets'
import type { TimelineClip, TrackKind } from './layer-model'
import type { Cue } from '../subtitles/model'
import { suggestZoom } from '../editor/effects'

type Props = {
  clip: TimelineClip; kind: TrackKind; at: number; fps: number; tr: boolean; locked: boolean
  seek: (frame: number) => void; apply: (animation?: Animation) => boolean
  clipboard: RefObject<Animation | undefined>; cues?: Cue[]
}
const labels: Record<Parameter, [string,string]> = {
  x:['X konumu','X position'], y:['Y konumu','Y position'], scale:['Ölçek','Scale'],
  rotation:['Dönüş °','Rotation °'], opacity:['Opaklık','Opacity'], volume:['Klip sesi','Clip gain'], reveal:['Görünür metin','Text reveal'],
}
const defaults = { x:.5,y:.5,scale:1,rotation:0,opacity:1,volume:1,reveal:1 }
const defaultBezier: Bezier = [.42,0,.58,1]

export function moveKeyframes(points: Keyframe[], chosen: ReadonlySet<number>, step: number, length: number) {
  const next = points.map(point => chosen.has(point.frame) ? { ...point, frame:point.frame+step } : point).sort((a,b)=>a.frame-b.frame)
  return next.every((point,index)=>point.frame>=0 && point.frame<length && (!index || next[index-1].frame<point.frame)) ? next : null
}

function BezierGraph({ point, lock, edit }: { point: Keyframe; lock: boolean; edit: (value: Bezier) => void }) {
  const value = point.bezier ?? bezierPresets[point.curve as keyof typeof bezierPresets] ?? defaultBezier
  const [draft,setDraft]=useState<Bezier>()
  const handle=useRef<number | null>(null)
  const svg=useRef<SVGSVGElement>(null)
  const config=draft ?? value
  function sample(event: PointerEvent<SVGCircleElement>) {
    const rect=svg.current!.getBoundingClientRect()
    const clamp = (number: number)=>Math.max(0,Math.min(1,Math.round(number*1000)/1000))
    const next: Bezier=[...config]
    const index=handle.current!
    next[index*2]=clamp(((event.clientX-rect.left)/rect.width*220-12)/196)
    next[index*2+1]=clamp((112-(event.clientY-rect.top)/rect.height*124)/100)
    return next
  }
  const curve = draft ? 'bezier' : point.curve
  const samples=Array.from({length:65},(_,i)=>{
    const x=i/64
    return [12+196*x,112-100*curveValue(x,curve,config)].join(',')
  })
  const path = curve === 'hold' ? '12,112 208,112 208,12' : samples.join(' ')
  return <svg className="keyframe-graph" ref={svg} viewBox="0 0 220 124" role="img" aria-label="Bézier">
    <path className="keyframe-axis" d="M12 12V112H208 M12 62H208 M110 12V112" />
    <polyline className="keyframe-curve" points={path} />
    {point.curve === 'bezier' && [0,1].map(index=>{
      const x=12+config[index*2]*196, y=112-config[index*2+1]*100
      return <g key={index}>
        <line className="keyframe-handle" x1={index ? 208 : 12} y1={index ? 12 : 112} x2={x} y2={y}/>
        <circle className="keyframe-point" cx={x} cy={y} r={6}
          onPointerDown={event=>{ if (!lock) { handle.current=index; event.currentTarget.setPointerCapture(event.pointerId) } }}
          onPointerMove={event=>{ if (handle.current===index) setDraft(sample(event)) }}
          onPointerUp={event=>{
            if (handle.current!==index) return
            const next=sample(event); handle.current=null; setDraft(undefined); edit(next)
          }}
          onPointerCancel={()=>{ handle.current=null; setDraft(undefined) }} />
      </g>
    })}
  </svg>
}

export function AnimationStudio({ clip,kind,at,fps,tr,locked,seek,apply,clipboard,cues }: Props) {
  const t=(turkish: string, english: string)=>tr ? turkish : english
  const [param,setParam]=useState<Parameter>(parametersByKind[kind][0])
  const parameter=parametersByKind[kind].includes(param) ? param : parametersByKind[kind][0]
  const [selected,setSelected]=useState<Set<number>>(()=>new Set())
  const [preset,setPreset]=useState(-1)
  const [duration,setDuration]=useState(fps)
  const [intensity,setIntensity]=useState(100)
  const [notice,setNotice]=useState('')
  const local=Math.max(0,Math.min(clip.length-1,at-clip.at))
  const points=clip.animation?.[parameter] ?? []
  const keys=new Set(points.filter(point=>selected.has(point.frame)).map(point=>point.frame))
  const current=points.find(point=>point.frame===local)
  const focused=current && (!keys.size || keys.has(local)) ? current : points.find(point=>keys.has(point.frame)) ?? current
  const [min,max]=keyframeBounds[parameter]
  const baseValue=(key: Parameter)=>(key==='x'||key==='y'||key==='scale'||key==='opacity' ? clip[key] : undefined) ?? defaults[key]
  const fallback=baseValue(parameter)
  const value=keyframeValue(points,local,fallback)
  const valueAtPoint = focused?.value ?? value

  function submit(animation: Animation) {
    try {
      const validated=keyframeDocument(animation,kind,clip.length)
      if (!apply(validated)) throw Error('keyframes')
      setNotice('')
      return true
    } catch {
      setNotice(t('Anahtar kareler bu klibin sınırlarına veya kanal kurallarına uymuyor.', 'The keyframes exceed this clip or conflict with the channel rules.'))
      return false
    }
  }
  function replace(next: Keyframe[]) {
    const animation={...clip.animation}
    if (next.length) animation[parameter]=next
    else delete animation[parameter]
    return submit(animation)
  }
  function setPoint(frame: number, value: number) {
    if (!Number.isFinite(value)||value<min||value>max) return
    const found=points.find(point=>point.frame===frame)
    const next={ ...(found ?? {frame,curve:'linear' as const}), value }
    if (replace([...points.filter(point=>point.frame!==frame),next].sort((a,b)=>a.frame-b.frame))) {
      setSelected(new Set([frame])); seek(frame+clip.at)
    }
  }
  function easing(curve: Curve, bezier?: Bezier) {
    if (!focused) return
    const next={ frame:focused.frame,value:focused.value,curve,...(curve==='bezier'?{bezier:bezier??defaultBezier}:{}) }
    replace(points.map(point=>point.frame===focused.frame ? next : point))
  }
  const motion=motionPresets[preset]
  const zoom=cues?.length && clip.inFrame!==undefined
    ? suggestZoom(cues,{start:clip.inFrame/fps,end:(clip.inFrame+clip.length)/fps}) : undefined
  return <section className="panel keyframe-studio" aria-label={t('Animasyon stüdyosu','Animation Studio')}>
    <header className="panel-header"><h2>{t('Animasyon stüdyosu','Animation Studio')}</h2><span>{local} f</span></header>
    <div className="keyframe-body">
      <label>{t('Kanal','Channel')}<select value={parameter} onChange={event=>{setParam(event.target.value as Parameter);setSelected(new Set())}}>
        {parametersByKind[kind].map(key=><option key={key} value={key}>{labels[key][tr?0:1]}</option>)}
      </select></label>
      <div className="keyframe-points" aria-label={t('Anahtar kareler','Keyframes')}>
        {points.map(point=><button type="button" key={point.frame} aria-pressed={keys.has(point.frame) || (!keys.size&&point.frame===local)}
          onClick={event=>{
            const next=new Set(event.ctrlKey||event.shiftKey||event.metaKey ? keys : [])
            if(next.has(point.frame))next.delete(point.frame)
            else next.add(point.frame)
            setSelected(next); seek(clip.at+point.frame)
          }}>◆ {point.frame}</button>)}
      </div>
      <fieldset disabled={locked}>
        <div className="layer-tools">
          <button type="button" disabled={points.length>=keyframeLimits.channel || !!current} onClick={()=>setPoint(local,value)}>
            {t('+ Anahtar kare','+ Keyframe')}</button>
          <button type="button" disabled={!focused} onClick={()=>{
            const removed=keys.size?keys:new Set([focused?.frame]); if(replace(points.filter(point=>!removed.has(point.frame))))setSelected(new Set())
          }}>{t('Kareleri sil','Delete keyframes')}</button>
        </div>
        <label>{t('Seçili değer','Selected value')}
          <input key={parameter+':'+(focused?.frame??local)+':'+valueAtPoint} type="number" min={min} max={max} step={parameter==='rotation'?1:.01}
            defaultValue={Number(valueAtPoint.toFixed(4))} onBlur={event=>{
              const next=event.target.valueAsNumber
              if(Number.isFinite(next)&&Math.abs(next-valueAtPoint)>.00005)setPoint(focused?.frame??local,next)
            }} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/>
        </label>
        {focused&&<>
          <label>{t('Kareye taşı','Move to frame')}<input type="number" key={parameter+':'+focused.frame} min={0} max={clip.length-1}
            defaultValue={focused.frame} onBlur={event=>{
              const at=event.target.valueAsNumber
              if(!Number.isInteger(at)||at===focused.frame)return
              const target=keys.size?keys:new Set([focused.frame])
              const delta=at-focused.frame, moved=moveKeyframes(points,target,delta,clip.length)
              if(moved&&replace(moved)){setSelected(new Set([...target].map(frame=>frame+delta)));seek(clip.at+at)}
              else {event.currentTarget.value=String(focused.frame);setNotice(t('Kare çakışması veya klip sınırı.', 'Keyframe collision or clip boundary.'))}
            }} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/></label>
          <label>{t('Çıkış eğrisi','Outgoing curve')}<select value={focused.curve} onChange={event=>easing(event.target.value as Curve,focused.bezier)}>
            {curves.map(curve=><option key={curve} value={curve}>{({linear:t('Doğrusal','Linear'),hold:t('Beklet','Hold'),
              'ease-in':'Ease In','ease-out':'Ease Out','ease-in-out':'Ease In-Out',bezier:'Cubic Bézier'})[curve]}</option>)}
          </select></label>
        </>}
      </fieldset>
      {focused&&<BezierGraph key={parameter+':'+focused.frame} point={focused} lock={locked} edit={value=>easing('bezier',value)} />}
      <fieldset disabled={locked}>
        <legend>{t('Hareket şablonları','Motion presets')}</legend>
        <select aria-label={t('Hareket şablonu','Motion preset')} value={preset} onChange={event=>setPreset(Number(event.target.value))}>
          <option value={-1}>{t('Şablon seç','Choose a preset')}</option>
          {motionPresets.map((motion,index)=>parametersByKind[kind].includes(motion.parameter)&&<option key={motion.en} value={index}>{tr?motion.tr:motion.en}</option>)}
        </select>
        <div className="layer-properties-grid">
          <label>{t('Süre · kare','Duration · frames')}<input type="number" min={1} max={clip.length-1} value={duration}
            onChange={event=>setDuration(event.target.valueAsNumber || 1)}/></label>
          <label>{t('Şiddet %','Intensity %')}<input type="number" min={1} max={200} value={intensity}
            onChange={event=>setIntensity(event.target.valueAsNumber || 1)}/></label>
        </div>
        <button type="button" disabled={!motion || !parametersByKind[kind].includes(motion.parameter) || local>=clip.length-1 ||
            duration<1 || intensity<1 || intensity>200}
          onClick={()=>{
            const value=keyframeValue(clip.animation?.[motion.parameter],local,baseValue(motion.parameter))
            const addition=presetAnimation(motion,value,local,Math.min(Math.round(duration),clip.length-1-local),intensity/100)
            const existing=clip.animation?.[motion.parameter]??[]
            const inserted=addition[motion.parameter]!
            const first=inserted[0].frame,last=inserted.at(-1)!.frame
            if(submit({...clip.animation,[motion.parameter]:[...existing.filter(point=>point.frame<first||point.frame>last),...inserted].sort((a,b)=>a.frame-b.frame)})){
              setParam(motion.parameter);setSelected(new Set(inserted.map(point=>point.frame)))
            }
          }}>{t('İmleçte uygula','Apply at playhead')}</button>
        {kind==='video'&&zoom&&<button type="button" onClick={()=>{
          const convert=(time: number)=>Math.max(0,Math.min(clip.length-1,Math.round(time*fps)-clip.inFrame!))
          const base=(clip.scale??1)
          const points=[...new Map([[0,base],[convert(zoom.start),base*zoom.from],[convert(zoom.end),base*zoom.to]])].map(([frame,value])=>({
            frame,value:Math.max(.1,Math.min(2,value)),curve:'ease-in-out' as const}))
          if(submit({...clip.animation,scale:points})){setParam('scale');setSelected(new Set())}
        }}>{t('Konuşma zoom önerisini aktar','Use speech zoom suggestion')}</button>}
      </fieldset>
      <div className="layer-tools">
        <button type="button" disabled={!clip.animation} onClick={()=>{clipboard.current=clip.animation;setNotice(t('Animasyon kopyalandı.','Animation copied.'))}}>
          {t('Animasyonu kopyala','Copy animation')}</button>
        <button type="button" disabled={locked} onClick={()=>{
          if(clipboard.current){submit(clipboard.current);setSelected(new Set())}
          else setNotice(t('Kopyalanmış animasyon yok.','No animation has been copied.'))
        }}>{t('Animasyonu yapıştır','Paste animation')}</button>
      </div>
      {notice&&<p role="status">{notice}</p>}
    </div>
  </section>
}
