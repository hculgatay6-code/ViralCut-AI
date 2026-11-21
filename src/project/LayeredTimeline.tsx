import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Copy } from '../i18n'
import type { Project, ProjectMedia, Waveform } from './model'
import { LayerOutput } from './LayerOutput'
import { sliceEffects } from '../../server/effect-document.mjs'
import { sliceAnimation } from '../../server/keyframes.mjs'
import type { Animation } from '../../server/keyframes.mjs'
import { useLayerThumbnails } from './layer-thumbnails'
import { addLayerClips, changeGap, deleteSelection, emptyTrack, frameCode, layerDuration, mediaClip,
  mergeLayerClip, moveSelection, putLayerClip, selectedClips, snapFrame, splitLayerClip, updateTrack } from './layer-model'
import type { ClipSelection, LayerTimeline, TimelineClip, Track, TrackKind } from './layer-model'

type Props = {
  project: Project; libraryHost?: HTMLDivElement | null; selectLayer?: (id:string)=>void; copy: Copy; tr: boolean
  inspector: HTMLDivElement | null; monitor: HTMLDivElement | null
  undo: boolean; redo: boolean; history: (op: 'undo' | 'redo') => void
  change: (apply: (project: Project) => Project) => void
  waveforms?: Record<string, Waveform>; stop: () => void
}
const EffectsStudio = lazy(() => import('./EffectsStudio').then(module => ({ default: module.EffectsStudio })))
const AnimationStudio = lazy(() => import('./AnimationStudio').then(module => ({ default: module.AnimationStudio })))
const empty = new Set<string>()
function visibleKeyframes(clip: TimelineClip, scale: number, start: number, end: number) {
  const positions = new Map<number, number>()
  for (const points of Object.values(clip.animation ?? {})) for (const { frame } of points) {
    const x = (clip.at + frame) * scale
    if (x >= start && x <= end) positions.set(Math.round(x / 4), frame)
  }
  return [...positions.values()]
}

const kindLabels = { video: ['Video', 'Video'], audio: ['Ses', 'Audio'], caption: ['Altyazı', 'Captions'], text: ['Metin', 'Text'] }
const prefix = { video: 'V', audio: 'A', caption: 'CC', text: 'T' }

async function duration(media: ProjectMedia) {
  const player = document.createElement(media.audioOnly ? 'audio' : 'video')
  player.preload = 'metadata'
  try {
    return await new Promise<number>((resolve, reject) => {
      const finish = (value: number) => {
        clearTimeout(timer)
        if (value > 0) resolve(value)
        else reject(Error('decode'))
      }
      const timer = window.setTimeout(() => finish(0), 8000)
      player.onloadedmetadata = () => finish(Number.isFinite(player.duration) ? player.duration : 0)
      player.onerror = () => finish(0)
      player.src = '/project-media/' + media.id
    })
  } finally { player.removeAttribute('src'); player.load() }
}

const Wave = memo(function Wave({ waveform, inFrame, length, fps }: {
  waveform: Waveform; inFrame: number; length: number; fps: number
}) {
  const points = Array.from({ length: 48 }, (_, index) => {
    const seconds = (inFrame + length * index / 48) / fps
    return Math.max(1, 11 * (waveform.peaks[Math.floor(seconds / waveform.step)] ?? 0))
  })
  if (!waveform.peaks.length) return null
  return <svg className="layer-wave" viewBox="0 0 96 24" preserveAspectRatio="none" aria-hidden="true">
    <path d={points.map((height, index) => `M${index * 2 + 1},${12 - height}v${2 * height}`).join(' ')} />
  </svg>
})

function Field({ label, value, set, min, max, step = 1 }: {
  label: string; value: number; set: (value: number) => void; min: number; max?: number; step?: number
}) {
  return <label>{label}<input type="number" key={value} defaultValue={value} min={min} max={max} step={step}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
    onBlur={event => {
      const input = event.currentTarget
      if (input.validity.valid && input.value.trim() && input.valueAsNumber !== value) set(input.valueAsNumber)
      input.value = String(value)
    }} /></label>
}

export function LayeredTimeline({ project, copy, tr, inspector, monitor, libraryHost, selectLayer, undo, redo, history, change, waveforms = {}, stop }: Props) {
  const timeline = project.timeline!
  const { fps } = timeline
  const t = (turkish: string, english: string) => tr ? turkish : english
  const [selection, setSelection] = useState<ReadonlySet<string>>(empty)
  const [trackId, setTrackId] = useState('')
  const [mediaId, setMediaId] = useState('')
  const [text, setText] = useState('')
  const [at, setAt] = useState(0)
  const [zoom, setZoom] = useState(75)
  const [snap, setSnap] = useState(true)
  const [ripple, setRipple] = useState(false)
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  const [wave, setWave] = useState<Record<string, Waveform>>({})
  const sourceLengths = useRef(new Map<string, number>())
  const clipboard = useRef<ClipSelection>([])
  const animationClipboard = useRef<Animation>(undefined)
  const effectsClipboard=useRef('')
  const drag = useRef<{ id: string; ids: ReadonlySet<string>; frame: number; x: number; y: number; scroll: number; key?: number; transition?: boolean; edge?: 'start' | 'end' } | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ left: 0, width: 1100 })
  const thumbnail = useLayerThumbnails(scroll, project.media)
  const [dragOffset, setDragOffset] = useState(0)
  const sourceMap = useMemo(() => new Map(project.media.map(entry => [entry.id, entry])), [project.media])
  const selected = useMemo(() => selectedClips(timeline, selection), [timeline, selection])
  const active = selected.length === 1 ? selected[0] : undefined
  useEffect(()=>{selectLayer?.(active?.track.kind=== 'video' ? active.clip.id : '');return()=>selectLayer?.('')},[active?.clip.id,active?.track.kind,selectLayer])
  const track = timeline.tracks.find(track => track.id === trackId) ?? active?.track ?? timeline.tracks[0]
  const total = useMemo(() => layerDuration(timeline), [timeline])
  const scale = Math.min(zoom / fps, 180000 / Math.max(1, total))
  const maxFrame = Math.min(86400 * fps, Math.max(at + 10 * fps, total + 10 * fps, 30 * fps))
  const width = Math.min(220000, Math.round(maxFrame * scale))
  const rulerStep = (Math.ceil(72 / (scale * fps)) || 1) * fps
  function fitTimeline() {
    setZoom(Math.max(6, Math.min(420, Math.floor((viewport.width - 126) * fps / Math.max(total, 1)))))
    if (scroll.current) scroll.current.scrollLeft = 0
  }
  const first = useRef(timeline)
  const expired = useRef(false)

  useEffect(() => {
    expired.current = false
    return () => { expired.current = true }
  }, [])
  useEffect(() => {
    if (first.current !== timeline) {
      first.current = timeline
      setAt(value => Math.min(value, Math.max(0, layerDuration(timeline) + 10 * timeline.fps)))
    }
  }, [timeline])

  useEffect(() => {
    const node = scroll.current
    if (!node) return
    let frame = 0
    function refresh() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setViewport({ left: node!.scrollLeft, width: node!.clientWidth }))
    }
    const observer = new ResizeObserver(refresh)
    observer.observe(node)
    node.addEventListener('scroll', refresh, { passive: true })
    return () => { observer.disconnect(); node.removeEventListener('scroll', refresh); cancelAnimationFrame(frame) }
  }, [])

  function commit(next: LayerTimeline | null) {
    if (!next) {
      setNotice(t('Bu işlem kilit, çakışma veya zaman sınırı nedeniyle uygulanamadı.', 'This edit conflicts with a lock, another clip, or the timeline limits.'))
      return false
    }
    setNotice('')
    const version = next.tracks.some(row => row.clips.some(item => item.effects?.length || item.incoming)) ? 4
      : project.version < 3 && next.tracks.some(row => row.clips.some(item => item.animation)) ? 3 : project.version
    change(current => current.timeline === timeline ? { ...current, version, timeline: next } : current)
    return true
  }

  function addTrack(kind: TrackKind) {
    if (timeline.tracks.length >= 24) return
    let number = 1
    while (timeline.tracks.some(item => item.name === prefix[kind] + number)) number++
    const next = emptyTrack(kind, prefix[kind] + number)
    commit({ ...timeline, tracks: [...timeline.tracks, next] })
    setTrackId(next.id)
  }

  async function sourceFrames(media: ProjectMedia) {
    const cached = sourceLengths.current.get(media.id)
    const seconds = cached ?? await duration(media)
    sourceLengths.current.set(media.id, seconds)
    return Math.floor(seconds * fps + .001)
  }

  async function addClip(destination = track, sourceId = mediaId, position = at) {
    if (!destination || destination.locked || adding) return
    if (destination.kind === 'caption' || destination.kind === 'text') {
      if (text.trim() && commit(putLayerClip(timeline, destination.id, { id: crypto.randomUUID(), at: position, length: 3 * fps, text: text.trim() }))) setText('')
      return
    }
    const source = sourceMap.get(sourceId)
    if (!source || source.missing || (source.audioOnly && destination.kind === 'video')) return
    setAdding(true); setNotice('')
    try {
      const frames = await sourceFrames(source)
      if (!expired.current) commit(putLayerClip(timeline, destination.id, mediaClip(source.id, destination.kind, position, 0, frames)))
    } catch {
      if (!expired.current) setNotice(copy.exportErrors.badSource)
    } finally { if (!expired.current) setAdding(false) }
  }

  async function importAudio() {
    if (adding || project.media.length >= 100) return
    setAdding(true)
    try {
      const result = await window.viralCutDesktop?.projects.addAudio()
      if (result?.error) throw Error(result.error)
      if (!result?.media || expired.current) return
      const media = result.media
      await sourceFrames(media)
      if (expired.current) return
      change(current => current.media.length < 100 ? { ...current, media: [...current.media, media] } : current)
      setMediaId(media.id)
      setTrackId(timeline.tracks.find(item => item.kind === 'audio' && !item.locked)?.id ?? '')
    } catch { if (!expired.current) setNotice(copy.exportErrors.badSource) }
    finally { if (!expired.current) setAdding(false) }
  }

  function paste(items: ClipSelection, position: number) {
    if (!items.length) return
    const start = Math.min(...items.map(({ clip }) => clip.at))
    const incoming = items.map(({ track, clip }) => ({ track, clip: { ...clip, id: crypto.randomUUID(), at: clip.at - start + position } }))
    if (commit(addLayerClips(timeline, incoming))) setSelection(new Set(incoming.map(({ clip }) => clip.id)))
  }

  function remove() {
    if (selected.length && commit(deleteSelection(timeline, selection, ripple))) setSelection(empty)
  }

  function split() {
    if (active) commit(splitLayerClip(timeline, active.track, active.clip, at))
  }

  async function trim(row: Track, clip: TimelineClip, mode: boolean) {
    const old = row.clips.find(item => item.id === clip.id)
    if (old?.effects && clip.length>=1) clip={...clip,effects:sliceEffects(old.effects,(clip.inFrame??clip.at)-(old.inFrame??old.at),clip.length)}
    if (old?.animation && clip.length >= 1) {
      const offset = (clip.inFrame ?? clip.at) - (old.inFrame ?? old.at)
      clip = { ...clip, animation: sliceAnimation(old.animation, offset, clip.length) }
    }
    const media = sourceMap.get(clip.mediaId ?? '')
    if (media && !media.missing && clip.inFrame !== undefined) {
      try {
        if (clip.inFrame + clip.length > await sourceFrames(media)) {
          if (!expired.current) setNotice(copy.exportErrors.badRange)
          return
        }
      } catch { if (!expired.current) setNotice(copy.exportErrors.badSource); return }
    }
    if (!expired.current) commit(putLayerClip(timeline, row.id, clip, mode))
  }

  function adjust(key: keyof TimelineClip, value: number | string) {
    if (!active || value === active.clip[key]) return
    const clip = { ...active.clip, [key]: value }
    if (key === 'inFrame' || key === 'length') void trim(active.track, clip, ripple && key === 'length')
    else commit(putLayerClip(timeline, active.track.id, clip))
  }

  function trackFlags(patch: Partial<Track>) {
    if (track) commit(updateTrack(timeline, track.id, value => ({ ...value, ...patch })))
  }

  function dragStart(event: PointerEvent<HTMLButtonElement>, row: Track, clip: TimelineClip) {
    if (event.button !== 0) return
    const multi = event.ctrlKey || event.metaKey || event.shiftKey
    const ids = new Set(multi || selection.has(clip.id) ? selection : [])
    if (multi && ids.has(clip.id)) ids.delete(clip.id)
    else ids.add(clip.id)
    setTrackId(row.id); setSelection(ids)
    if (row.locked || multi || adding) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const transition=event.target instanceof HTMLElement && event.target.hasAttribute('data-fx-transition')
    const marker=event.target instanceof HTMLElement ? event.target.dataset.keyframe : undefined
    if (marker !== undefined) setAt(clip.at+Number(marker))
    const bounds = event.currentTarget.getBoundingClientRect()
    const edge = bounds.width > 24 ? event.clientX - bounds.left < 7 ? 'start' :
      bounds.right - event.clientX < 7 ? 'end' : undefined : undefined
    drag.current = { id: clip.id, ids, frame: edge === 'end' ? clip.at + clip.length : clip.at,
      x: event.clientX, y: event.clientY, scroll: scroll.current?.scrollLeft ?? 0, edge, transition, key:marker===undefined ? undefined : Number(marker) }
  }

  function dragMove(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current
    if (start && !start.edge && !start.transition && start.key===undefined) setDragOffset(Math.round(event.clientX - start.x + (scroll.current?.scrollLeft ?? 0) - start.scroll))
  }

  function dragFinish(event: PointerEvent<HTMLButtonElement>) {
    const origin = drag.current
    drag.current = null; setDragOffset(0)
    if (!origin) return
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 4) return
    const raw = origin.frame + (event.clientX - origin.x + (scroll.current?.scrollLeft ?? 0) - origin.scroll) / scale
    const nearest = snap ? snapFrame(timeline, raw, at, Math.min(fps / 3, 9 / scale), new Set(origin.ids)) : Math.max(0, Math.round(raw))
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-layer-row]')?.dataset.layerRow
    const source = timeline.tracks.find(track => track.clips.some(clip => clip.id === origin.id))
    if (origin.transition) {
      const clip=source?.clips.find(item=>item.id===origin.id)
      if (!source||!clip?.incoming) return
      const start=Math.max(0,Math.min(clip.length-clip.incoming.length,clip.incoming.start+Math.round(raw-origin.frame)))
      if (start!==clip.incoming.start && commit(putLayerClip(timeline,source.id,{...clip,incoming:{...clip.incoming,start}}))) setAt(clip.at+start)
      return
    }
    if (origin.key !== undefined) {
      const clip=source?.clips.find(item=>item.id===origin.id)
      if (!source||!clip?.animation) return
      const key=origin.key
      const step=Math.round((event.clientX-origin.x+(scroll.current?.scrollLeft??0)-origin.scroll)/scale)
      const frame=Math.max(0,Math.min(clip.length-1,key+step))
      if (frame===key) return
      const animation: Animation={}
      for (const [channel,points] of Object.entries(clip.animation)) {
        if (points.some(point=>point.frame===key) && points.some(point=>point.frame===frame)) {
          setNotice(t('Bu karede zaten bir anahtar kare var.','A keyframe already occupies that frame.'))
          return
        }
        animation[channel as keyof Animation]=points.map(point=>point.frame===key?{...point,frame}:point).sort((a,b)=>a.frame-b.frame)
      }
      if (commit(putLayerClip(timeline,source.id,{...clip,animation}))) setAt(clip.at+frame)
      return
    }
    if (origin.edge) {
      const clip = source?.clips.find(item => item.id === origin.id)
      if (!source || !clip) return
      const delta = nearest - origin.frame
      const next = origin.edge === 'start' ? { ...clip, at: nearest, length: clip.length - delta,
        ...(clip.inFrame === undefined ? {} : { inFrame: clip.inFrame + delta }) } : { ...clip, length: clip.length + delta }
      void trim(source, next, ripple && origin.edge === 'end')
      return
    }
    if (target && target !== source?.id) {
      if (commit(moveSelection(timeline, origin.ids, nearest - origin.frame, target))) setTrackId(target)
    } else commit(moveSelection(timeline, origin.ids, nearest - origin.frame))
  }

  async function prepareWave() {
    const id = active?.clip.mediaId
    const bridge = window.viralCutDesktop?.projects
    if (!id || !bridge) return
    setNotice(t('Dalga formu hazırlanıyor…', 'Preparing waveform…'))
    try {
      let result = await bridge.prepare(id, 'waveform')
      for (let attempt = 0; !expired.current && ['queued', 'running'].includes(result.phase ?? '') && attempt < 360; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 700))
        result = await bridge.previewStatus(id, 'waveform')
      }
      if (expired.current) return
      if (result.phase !== 'ready' || !result.peaks || !result.step) throw Error('waveform')
      setWave(current => ({ ...current, [id]: { peaks: result.peaks!, step: result.step! } })); setNotice('')
    } catch { if (!expired.current) setNotice(copy.exportErrors.badSource) }
  }

  const settings = <fieldset>
    <legend>{t('Çıktı ayarları', 'Output settings')}</legend>
    <label>{copy.resolution}<select value={project.profile.resolution} onChange={event => {
      const resolution = Number(event.target.value) as Project['profile']['resolution']
      change(value => ({ ...value, profile: { ...value.profile, resolution } }))
    }}><option value="720">720p</option><option value="1080">1080p</option></select></label>
    <label>{t('Kare oranı', 'Aspect ratio')}<select value={project.frame?.mode ?? 'landscape'} onChange={event => {
      const mode = event.target.value as NonNullable<Project['frame']>['mode']
      change(value => ({ ...value, frame: { mode, zoom: 1, x: 0, y: 0 } }))
    }}><option value="landscape">16:9</option><option value="vertical">9:16</option><option value="square">1:1</option></select></label>
    <label>{copy.encodingMode}<select value={project.encoder} onChange={event => {
      const encoder = event.target.value as Project['encoder']
      change(value => ({ ...value, encoder }))
    }}><option value="auto">{copy.encodingAuto}</option><option value="cpu">CPU</option></select></label>
    <label><input type="checkbox" checked={project.burn} onChange={event => {
      const burn = event.target.checked
      change(value => ({ ...value, burn }))
    }} />{t('Altyazı ve metni işle', 'Burn captions and text')}</label>
  </fieldset>

  const properties = <>
  {active?.track.kind === 'video' && <Suspense fallback={null}><EffectsStudio key={active.clip.id}
    clip={active.clip} fps={fps} at={at} tr={tr} locked={active.track.locked} clipboard={effectsClipboard} libraryHost={libraryHost}
    adjacent={active.track.clips.some(item=>item.at+item.length===active.clip.at)}
    apply={clip=>commit(putLayerClip(timeline,active.track.id,clip))} /></Suspense>}
  {active && <Suspense fallback={null}><AnimationStudio key={active.clip.id} clip={active.clip} kind={active.track.kind} at={at} fps={fps}
    tr={tr} locked={active.track.locked} seek={setAt} clipboard={animationClipboard}
    cues={sourceMap.get(active.clip.mediaId ?? '')?.cues}
    apply={animation => commit(putLayerClip(timeline, active.track.id, { ...active.clip, animation }))} /></Suspense>}
  <section className="panel layer-properties">
    <header className="panel-header"><h2>{t('Katman ve klip ayarları', 'Track and clip settings')}</h2></header>
    {track && <div className="layer-properties-body">
      <label>{t('Katman adı', 'Track name')}<input key={track.id + track.name} defaultValue={track.name} maxLength={60}
        disabled={track.locked} onBlur={event => {
          const name = event.currentTarget.value.trim()
          if (name && name !== track.name) trackFlags({ name })
          else event.currentTarget.value = track.name
        }} /></label>
      <div className="layer-tools">
        <button type="button" aria-pressed={track.locked} onClick={() => trackFlags({ locked: !track.locked })}>{t('Kilitle', 'Lock')}</button>
        <button type="button" aria-pressed={track.hidden} onClick={() => trackFlags({ hidden: !track.hidden })}>{t('Gizle', 'Hide')}</button>
        {track.kind === 'audio' && <>
          <button type="button" aria-pressed={track.muted} onClick={() => trackFlags({ muted: !track.muted })}>{t('Sustur', 'Mute')}</button>
          <button type="button" aria-pressed={track.solo} onClick={() => trackFlags({ solo: !track.solo })}>Solo</button>
        </>}
      </div>
      {track.kind === 'audio' && <Field label={t('Katman sesi %', 'Track volume %')} value={Math.round(track.gain * 100)} min={0} max={200} set={gain => trackFlags({ gain: gain / 100 })} />}
      <button type="button" disabled={track.locked || !!track.clips.length} onClick={() => {
        commit({ ...timeline, tracks: timeline.tracks.filter(item => track.id !== item.id) }); setTrackId('')
      }}>{t('Boş katmanı sil', 'Delete empty track')}</button>
      {active && <fieldset key={active.clip.id} disabled={active.track.locked}>
        <legend>{active.clip.mediaId ? sourceMap.get(active.clip.mediaId)?.name : kindLabels[active.track.kind][tr ? 0 : 1]}</legend>
        <Field label={t('Konum · kare', 'Position · frames')} min={0} value={active.clip.at} set={at => adjust('at', at)} />
        {active.clip.inFrame !== undefined && <Field label={t('Kaynak başlangıcı · kare', 'Source in · frames')}
          min={0} value={active.clip.inFrame} set={value => adjust('inFrame', value)} />}
        <Field label={t('Uzunluk · kare', 'Length · frames')} min={1} value={active.clip.length} set={value => adjust('length', value)} />
        {active.clip.text !== undefined && <label>{t('Metin', 'Text')}<textarea key={active.clip.id + active.clip.text} maxLength={500}
          defaultValue={active.clip.text} onBlur={event => {
            const value = event.currentTarget.value
            if (value.trim()) adjust('text', value)
            else event.currentTarget.value = active.clip.text!
          }} /></label>}
        {active.track.kind === 'video' && <div className="layer-properties-grid">
          {([['x', 'X %', 0, 100], ['y', 'Y %', 0, 100], ['scale', t('Ölçek %', 'Scale %'), 10, 200], ['opacity', t('Opaklık %', 'Opacity %'), 0, 100]] as const)
            .map(([key, label, min, max]) => <Field key={key} label={label} min={min} max={max}
              value={Math.round(active.clip[key]! * 100)} set={value => adjust(key, value / 100)} />)}
        </div>}
        {active.track.kind === 'audio' && <button type="button" onClick={() => void prepareWave()}>{t('Dalga formu hazırla', 'Prepare waveform')}</button>}
      </fieldset>}
    </div>}
    <div className="layer-properties-body">{settings}</div>
  </section></>

  const windowStart = Math.max(0, viewport.left - 240)
  const windowEnd = viewport.left + viewport.width + 240
  const tickWidth = rulerStep * scale
  const firstTick = Math.floor(windowStart / tickWidth)
  const tickCount = Math.max(0, Math.ceil(Math.min(width, windowEnd) / tickWidth) - firstTick)
  const visibleTracks = [...timeline.tracks.filter(track => track.kind === 'video').reverse(), ...timeline.tracks.filter(track => track.kind !== 'video')]
  return <div className="layer-editor" onKeyDown={event => {
    if (event.target instanceof Element && event.target.closest('input, textarea, select, video')) return
    const key = event.key.toLowerCase()
    if (event.ctrlKey || event.metaKey) {
      if (key === 'c') clipboard.current = selected
      else if (key === 'v') paste(clipboard.current, at)
      else if (key === 'd' && selected.length) paste(selected, Math.max(...selected.map(({ clip }) => clip.at + clip.length)))
      else return
    } else if (key === 'delete') remove()
    else if (key === 's') split()
    else if (key === 'f') fitTimeline()
    else if (key === '+' || key === '=') setZoom(value => Math.min(420, Math.round(value * 1.25)))
    else if (key === '-') setZoom(value => Math.max(6, Math.round(value / 1.25)))
    else if (key === 'arrowleft' || key === 'arrowright') setAt(value => Math.max(0, Math.min(maxFrame, value + (key === 'arrowleft' ? -1 : 1))))
    else return
    event.preventDefault()
  }}>
    <div className="layer-tools">
      <button type="button" disabled={!undo} onClick={() => history('undo')}>{copy.undo}</button>
      <button type="button" disabled={!redo} onClick={() => history('redo')}>{copy.redo}</button>
      {(Object.keys(kindLabels) as TrackKind[]).map(kind => <button key={kind} type="button" onClick={() => addTrack(kind)}
        disabled={timeline.tracks.length >= 24}>+ {kindLabels[kind][tr ? 0 : 1]}</button>)}
      <button type="button" aria-pressed={snap} onClick={() => setSnap(!snap)}>{t('Hizala', 'Snap')}</button>
      <button type="button" aria-pressed={ripple} onClick={() => setRipple(!ripple)}>Ripple</button>
      <label>{copy.zoom}<input type="range" min="6" max="420" value={zoom} onChange={event => setZoom(Number(event.currentTarget.value))} /></label>
      <button type="button" aria-keyshortcuts="F" disabled={!total} onClick={fitTimeline}>{t('Zaman çizelgesine sığdır', 'Fit timeline')}</button>
      <output>{frameCode(at, fps)} · {fps} FPS</output>
    </div>
    <div className="layer-tools">
      <button type="button" disabled={adding || project.media.length >= 100} onClick={() => void importAudio()}>{t('Ses dosyası ekle', 'Import audio file')}</button>
      {track && (track.kind === 'caption' || track.kind === 'text' ?
        <input aria-label={t('Yeni metin', 'New text')} maxLength={500} value={text} onChange={event => setText(event.target.value)} /> :
        <select aria-label={t('Katmana eklenecek medya', 'Media to place on track')} value={mediaId} onChange={event => setMediaId(event.target.value)}>
          <option value="">{t('Medya seç', 'Choose media')}</option>
          {project.media.filter(item => !item.missing && (track.kind === 'audio' || !item.audioOnly)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>)}
      <button type="button" disabled={!track || track.locked || adding || !(track.kind === 'caption' || track.kind === 'text' ? text.trim() : mediaId)}
        onClick={() => void addClip()}>{t('İmlece ekle', 'Add at playhead')}</button>
      <button type="button" disabled={!active || active.track.locked} onClick={split}>{t('Böl', 'Split')}</button>
      <button type="button" disabled={!active || active.track.locked} onClick={() => {
        if (active) commit(mergeLayerClip(timeline, active.track, active.clip))
      }}>{t('Birleştir', 'Join')}</button>
      <button type="button" disabled={!selected.length} onClick={remove}>{t('Sil', 'Delete')}</button>
      <button type="button" disabled={!selected.length} onClick={() => { clipboard.current = selected; setNotice(t('Klipler kopyalandı.', 'Clips copied.')) }}>{t('Kopyala', 'Copy')}</button>
      <button type="button" onClick={() => paste(clipboard.current, at)}>{t('Yapıştır', 'Paste')}</button>
      <button type="button" disabled={!selected.length} onClick={() => paste(selected, Math.max(...selected.map(({ clip }) => clip.at + clip.length)))}>{t('Çoğalt', 'Duplicate')}</button>
      <button type="button" disabled={!track || track.locked} onClick={() => track && commit(changeGap(timeline, track, at, fps))}>{t('1 sn boşluk ekle', 'Insert 1 s gap')}</button>
      <button type="button" disabled={!track || track.locked} onClick={() => track && commit(changeGap(timeline, track, at, -1))}>{t('Boşluğu kapat', 'Close gap')}</button>
    </div>
    <label className="layer-frame-input">{t('İmleç karesi', 'Playhead frame')}<input aria-label={t('İmleç karesi', 'Playhead frame')}
      type="number" min={0} max={86400 * fps} value={at} onChange={event => {
        const frame = event.currentTarget.valueAsNumber
        if (Number.isInteger(frame) && frame >= 0 && frame <= 86400 * fps) setAt(frame)
      }} /></label>
    <div onPointerDown={stop}><LayerOutput project={project} playhead={at} seek={setAt} monitor={monitor} tr={tr} copy={copy} /></div>
    <div ref={scroll} className="layer-scroll" tabIndex={0} aria-label={t('Çok katmanlı zaman çizelgesi', 'Multitrack timeline')}>
      <div className="layer-sheet" style={{ '--layer-width': width + 'px' } as CSSProperties}>
        <div className="layer-line layer-ruler">
          <div className="layer-label">{t('Katmanlar', 'Tracks')}</div>
          <div className="layer-time" onPointerDown={event => {
            const x = event.clientX - event.currentTarget.getBoundingClientRect().left
            setAt(snap ? snapFrame(timeline, x / scale, at, Math.min(fps / 3, 7 / scale)) : Math.max(0, Math.min(maxFrame, Math.round(x / scale))))
          }}>{Array.from({ length: tickCount }, (_, offset) => {
            const index = firstTick + offset
            return <span key={index} style={{ left: index * tickWidth }}>{frameCode(index * rulerStep, fps)}</span>
          })}</div>
        </div>
        {visibleTracks.map(row => <div className="layer-line" key={row.id}>
          <button className="layer-label" type="button" aria-current={track?.id === row.id} title={row.name} onClick={() => {
            setTrackId(row.id); setSelection(empty)
          }}>{row.name}{row.locked ? ' · ⌑' : ''}{row.hidden ? ' · ◌' : ''}{row.muted ? ' · M' : ''}{row.solo ? ' · S' : ''}
            <small>{kindLabels[row.kind][tr ? 0 : 1]}</small></button>
          <div className="layer-lane" data-layer-row={row.id} data-kind={row.kind} data-hidden={row.hidden} style={{ backgroundSize: rulerStep * scale + 'px 100%' }}
            onDragOver={event => {
              if (row.locked || (row.kind !== 'video' && row.kind !== 'audio') ||
                  !event.dataTransfer.types.includes('application/x-viralcut-media')) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={event => {
              const sourceId = event.dataTransfer.getData('application/x-viralcut-media')
              if (row.locked || !sourceMap.has(sourceId) || (row.kind !== 'video' && row.kind !== 'audio')) return
              event.preventDefault()
              const exact = (event.clientX - event.currentTarget.getBoundingClientRect().left) / scale
              const frame = snap ? snapFrame(timeline, exact, at, Math.min(fps / 3, 7 / scale)) : Math.max(0, Math.round(exact))
              setTrackId(row.id)
              void addClip(row, sourceId, frame)
            }}
            onPointerDown={event => {
              if (event.target !== event.currentTarget) return
              setTrackId(row.id); setSelection(empty)
            }}>
            {row.clips.filter(clip => selection.has(clip.id) ||
              ((clip.at + clip.length) * scale >= windowStart && clip.at * scale <= windowEnd)).map(clip => {
              const label = clip.text ?? sourceMap.get(clip.mediaId!)?.name ?? copy.missingProjectMedia
              const waveform = clip.mediaId ? (wave[clip.mediaId] ?? waveforms[clip.mediaId]) : undefined
              return <button type="button" key={clip.id} aria-pressed={selection.has(clip.id)} title={label}
                onClick={event => { if (event.detail === 0) { setTrackId(row.id); setSelection(new Set([clip.id])) } }}
                className="layer-clip" style={{ left: clip.at * scale, width: Math.max(3, clip.length * scale),
                  translate: dragOffset && selection.has(clip.id) ? dragOffset + 'px 0' : undefined }}
                onPointerDown={event => dragStart(event, row, clip)} onPointerMove={dragMove} onPointerUp={dragFinish}
                onPointerCancel={() => { drag.current = null; setDragOffset(0) }}>
                {row.kind === 'video' && clip.mediaId && !sourceMap.get(clip.mediaId)?.missing &&
                  <img key={clip.mediaId + ':' + clip.inFrame} className="layer-thumb" alt="" ref={thumbnail}
                    data-source={clip.mediaId} data-time={clip.inFrame! / fps} />}
                {row.kind === 'audio' && waveform && <Wave waveform={waveform} inFrame={clip.inFrame!} length={clip.length} fps={fps} />}
                <span>{label}{!!clip.effects?.length && <small className="fx-badge" aria-hidden="true">FX {clip.effects.length}</small>}</span>
                {clip.incoming && <i className="fx-transition" data-fx-transition title={clip.incoming.id}
                  style={{left:clip.incoming.start/clip.length*100+'%',width:clip.incoming.length/clip.length*100+'%'}} />}
                {clip.animation && <span className="keyframe-markers" aria-hidden="true">
                  {visibleKeyframes(clip, scale, windowStart, windowEnd).map(frame =>
                    <i key={frame} data-keyframe={frame} title={t('Anahtar kare','Keyframe')+' '+frame} style={{left:frame/clip.length*100+'%'}} />)}
                </span>}
                {clip.length * scale > 24 && !row.locked && <><i className="layer-trim start" /><i className="layer-trim end" /></>}
              </button>
            })}
          </div>
        </div>)}
        <div aria-hidden="true" className="layer-head" style={{ left: 'calc(var(--layer-label) + ' + at * scale + 'px)' }} />
      </div>
    </div>
    {notice && <p role="status">{notice}</p>}
    {inspector ? createPortal(properties, inspector) : properties}
  </div>
}
