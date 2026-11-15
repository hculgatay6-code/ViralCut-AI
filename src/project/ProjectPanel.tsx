import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ClipRange } from '../editor/model'
import { timecode } from '../editor/model'
import type { Copy, Language } from '../i18n'
import type { Project, Profile, ProjectMedia, ProjectClip, Waveform } from './model'
import { moveClip, subtractSpeech, timelineLayout } from './model'
import { ExportClientError, localExporter } from '../export/client'
import type { ExportJob } from '../export/client'

import { LayeredTimeline } from './LayeredTimeline'
import { layerDuration, layerFromLegacy } from './layer-model'

type Props = {
  project: Project; copy: Copy; media?: ProjectMedia; undo: boolean; redo: boolean; playhead: number
  autosaveInterval: number; language: Language; projectEpoch: number
  playback: boolean; stop: () => void; play: () => void; select: (clip: ProjectClip) => void
  current: string; setCurrent: (id: string) => void
  update: (apply: (project: Project) => Project) => void; load: (project: Project) => void
  history: (action: 'undo' | 'redo') => void; addMedia: (entries: ProjectMedia[]) => void
  range: ClipRange; duration: number; setProfile: (profile: Profile) => void
  framing?: Project['frame']
  removals: ClipRange[]
  monitorHost: HTMLDivElement | null
  settingsHost: HTMLDivElement | null; speechHost: HTMLDivElement | null
  openSource: () => void; selectSpeech: (range: ClipRange) => void; seekProject: (clip: ProjectClip, time: number) => void
  waveforms?: Record<string, Waveform>
}

export function ProfileFields({ profile, set, copy }: { profile: Profile; set: (value: Profile) => void; copy: Copy }) {
  return <div className="project-controls">
    <label>{copy.resolution}<select aria-label={copy.resolution} value={profile.resolution}
      onChange={e => set({ ...profile, resolution: Number(e.target.value) as Profile['resolution'] })}>
      <option value="720">720p</option><option value="1080">1080p</option></select></label>
    <label>FPS<select aria-label="FPS" value={profile.fps} onChange={e => set({ ...profile, fps: Number(e.target.value) as Profile['fps'] })}>
      {[24, 25, 30, 50, 60].map(value => <option key={value}>{value}</option>)}</select></label>
    <label>{copy.quality}<select aria-label={copy.quality} value={profile.quality}
      onChange={e => set({ ...profile, quality: e.target.value as Profile['quality'] })}>
      <option value="quality">{copy.qualityHigh}</option><option value="balanced">{copy.qualityBalanced}</option><option value="small">{copy.qualitySmall}</option>
    </select></label>
    <label>{copy.bitrate}<input type="number" min="0" max="50000" step="500" value={profile.bitrate}
      onChange={e => { const value = Number(e.target.value); if (Number.isInteger(value)) set({ ...profile, bitrate: Math.max(0, Math.min(50000, value)) }) }} /></label>
  </div>
}

function TransitionMonitor({ project, clip, next, copy }: { project: Project; clip: ProjectClip; next: ProjectClip; copy: Copy }) {
  const [state, setState] = useState<{ url?: string; progress?: number; error?: string }>({})
  const active = useRef<{ signal: AbortController; id?: string }>(null)
  function release() {
    const job = active.current
    job?.signal.abort()
    if (job?.id) void localExporter.release(job.id)
    active.current = null
  }
  useEffect(() => release, [])
  async function render() {
    const previous = active.current
    release()
    const job: { signal: AbortController; id?: string } = { signal: new AbortController() }
    const signal = job.signal.signal
    active.current = job
    setState({ progress: 0 })
    try {
      if (previous?.id) await localExporter.release(previous.id)
      signal.throwIfAborted()
      job.id = (await localExporter.createSequence({ ...project, profile: { ...project.profile, resolution: 720 },
        clips: [{ ...clip, start: Math.max(clip.start, clip.end - 3) }, { ...next, end: Math.min(next.end, next.start + 3), transition: undefined }] }, true)).id
      while (!signal.aborted) {
        const value = await localExporter.status(job.id, signal)
        if (value.phase === 'failed') throw new ExportClientError(value.error ?? 'encodeFailed')
        if (value.phase === 'ready') { setState({ url: localExporter.monitorUrl(job.id) }); return }
        setState({ progress: value.progress })
        await new Promise(resolve => setTimeout(resolve, 220))
      }
    } catch (error) {
      if (!signal.aborted) setState({ error: copy.exportErrors[error instanceof ExportClientError ? error.code : 'serviceError'] })
    } finally { if (signal.aborted && job.id) await localExporter.release(job.id) }
  }
  return <div className="fx-transition-preview">
    <button className="export-cancel" disabled={state.progress !== undefined} onClick={() => void render()}>{copy.fxTransitionPreview}</button>
    {(state.url || state.progress !== undefined) && <button className="export-cancel" onClick={() => { release(); setState({}) }}>{copy.close}</button>}
    {state.progress !== undefined && <progress max={100} value={state.progress} />}
    {state.url && <video className="fx-monitor" src={state.url} controls autoPlay />}
    {state.error && <p role="alert">{state.error}</p>}
  </div>
}

function SequenceExport({ project, copy }: { project: Project; copy: Copy }) {
  const [status, setStatus] = useState<ExportJob>()
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const [stage, setStage] = useState<'idle' | 'processing' | 'ready' | 'saving'>('idle')
  const [eta, setEta] = useState<number>()
  const active = useRef<{ id?: string; controller: AbortController } | null>(null)
  useEffect(() => {
    function cancel() { active.current?.controller.abort(); if (active.current?.id) void localExporter.release(active.current.id) }
    window.addEventListener('pagehide', cancel)
    return () => { window.removeEventListener('pagehide', cancel); cancel() }
  }, [])
  async function start() {
    if (active.current) return
    const operation: { id?: string; controller: AbortController } = { controller: new AbortController() }
    active.current = operation
    const signal = operation.controller.signal
    setStage('processing'); setMessage(''); setFailed(false); setStatus(undefined); setEta(undefined)
    const started = performance.now()
    let ready = false
    try {
      const job = await localExporter.createSequence(project)
      operation.id = job.id
      while (!signal.aborted) {
        const next = await localExporter.status(job.id, signal)
        setStatus(next)
        if (next.phase === 'failed') throw new ExportClientError(next.error ?? 'verifyFailed')
        if (next.phase === 'ready') { ready = true; setStage('ready'); return }
        setEta(next.progress > 3 && next.progress < 93 ?
          Math.ceil((performance.now() - started) / 1000 * (100 - next.progress) / next.progress) : undefined)
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    } catch (error) {
      if (!signal.aborted) {
        setFailed(true)
        setMessage(copy.exportErrors[error instanceof ExportClientError ? error.code : 'serviceError'] ?? copy.exportErrors.serviceError)
      }
    } finally {
      if (!ready) {
        if (operation.id) await localExporter.release(operation.id)
        active.current = null
        setStage('idle')
        if (signal.aborted) setMessage(copy.exportCancelled)
      }
    }
  }
  async function cancel() {
    const op = active.current
    if (!op) return
    op.controller.abort()
    if (stage === 'processing') return
    if (op.id) await localExporter.release(op.id)
    active.current = null
    setStage('idle'); setMessage(copy.exportCancelled)
  }
  async function save() {
    const op = active.current
    if (!op?.id) return
    setStage('saving'); setFailed(false); setMessage('')
    try {
      const saved = await localExporter.save(op.id, 'ViralCut-proje.mp4', op.controller.signal)
      await localExporter.release(op.id)
      active.current = null
      setStage('idle'); setMessage(copy.exportSaved + ' ' + saved.filename)
    } catch (error) {
      if (op.controller.signal.aborted) return
      const missing = error instanceof ExportClientError && error.code === 'jobMissing'
      if (missing) {
        active.current = null
        setStatus(undefined)
      }
      setStage(missing ? 'idle' : 'ready')
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setFailed(true); setMessage(missing ? copy.exportErrors.jobMissing : copy.exportErrors.saveFailed)
      }
    }
  }
  return <div className="project-export">
    <div className="shorts-actions">
      {stage === 'idle' && <button className="primary" disabled={!project.clips.length || project.clips.some(clip => project.media.find(m => m.id === clip.mediaId)?.missing)}
        onClick={() => void start()}>{copy.exportSequence}</button>}
      {(stage === 'ready' || stage === 'saving') && <button className="primary" disabled={stage === 'saving'} onClick={() => void save()}>{copy.saveSequence}</button>}
      {stage !== 'idle' && <button className="export-cancel" onClick={() => void cancel()}>{copy.exportCancel}</button>}
    </div>
    {stage === 'processing' && <div className="export-progress" role="status">
      <progress aria-label={copy.exportSequence} value={status?.progress ?? 0} max={100} />
      {Math.floor(status?.progress ?? 0)}% · {eta === undefined ? copy.exportProcessing : copy.eta + ' ' + timecode(eta, false)}
    </div>}
    {status?.verification && <p>{copy.verifiedOutput} · {status.verification.width} × {status.verification.height} ·
      {' '}{status.verification.fps} FPS · {timecode(status.verification.duration)} · H.264/AAC · {status.encoder}
      {status.verification.captions && ' · ' + copy.burnSubtitles}</p>}
    {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
  </div>
}

export function ProjectPanel(props: Props) {
  const { project, copy, media, update, current, setCurrent, addMedia, playhead, playback, stop, play, select } = props
  const { autosaveInterval, language } = props
  const tr = language === 'tr'
  const bridge = window.viralCutDesktop?.projects
  const [legacy, setLegacy] = useState(false)
  const layered = !legacy && project.timeline
  const [zoom, setZoom] = useState(85)
  const [dragged, setDragged] = useState<number>()
  const [selectedSpeech, setSelectedSpeech] = useState<Set<number>>(new Set())
  const [speechPage, setSpeechPage] = useState(0)
  const [notice, setNotice] = useState('')
  const [failed, setFailed] = useState(false)
  const [recovery, setRecovery] = useState<{ available?: boolean; damaged?: boolean; fallback?: boolean }>({})
  const [saved, setSaved] = useState<Project>()
  const [autosaveFailed, setAutosaveFailed] = useState(false)
  const [dialog, setDialog] = useState(false)
  const clip = project.clips.find(item => item.id === current)
  const speechCues = media?.cues ?? []
  const layout = useMemo(() => timelineLayout(project.clips, project.media, project.profile.fps), [project.clips, project.media, project.profile.fps])
  const ref = useRef(project)
  const lastSaved = useRef<Project | null>(null)
  const writing = useRef<Promise<void> | null>(null)
  ref.current = project
  const autosave = useCallback(async () => {
    const latest = ref.current
    if (!bridge || !autosaveInterval || (!latest.media.length && !latest.timeline) || latest === lastSaved.current || writing.current) return
    writing.current = bridge.autosave(latest).then(result => {
      if (result.saved) { lastSaved.current = latest; setSaved(latest) }
      setAutosaveFailed(!result.saved && !result.disabled)
    }).catch(() => setAutosaveFailed(true)).finally(() => { writing.current = null })
    await writing.current
  }, [bridge, autosaveInterval])
  useEffect(() => bridge?.onClose(() => {
    void Promise.resolve(writing.current).then(autosave).finally(() => bridge.confirmClose().catch(() => {}))
  }), [bridge, autosave])
  useEffect(() => { if (bridge) void bridge.hasRecovery().then(setRecovery).catch(() => {}) }, [bridge])
  useEffect(() => {
    if (!bridge || !autosaveInterval || recovery.available) return
    const timer = window.setInterval(() => { void autosave() }, autosaveInterval * 1000)
    return () => clearInterval(timer)
  }, [bridge, autosaveInterval, autosave, recovery.available])
  useEffect(() => { setSelectedSpeech(new Set()); setSpeechPage(0) }, [media?.id, media?.cues])
  if (!bridge) return null

  async function projectDialog(kind: 'add' | 'open' | 'save' | 'recover' | 'relink', id?: string) {
    if (!bridge || dialog) return
    setDialog(true); setNotice(''); setFailed(false)
    try {
      if (kind === 'add') {
        const result = await bridge.addMedia()
        if (result.media?.length) addMedia(result.media)
        if (result.error || result.rejected) throw Error()
      } else if (kind === 'relink' && id) {
        const result = await bridge.relink(id)
        if (result.error) throw Error()
        const selected = result.media
        if (selected) update(value => ({ ...value, media: value.media.map(item => item.id === id ? { ...selected, cues: item.cues } : item) }))
      } else if (kind === 'save') {
        const result = await bridge.save(ref.current)
        if (result.error) throw Error()
        if (result.filename) setNotice(copy.exportSaved + ' ' + result.filename)
      } else {
        const result = kind === 'recover' ? await bridge.recover() : await bridge.open()
        if (result.error) throw Error()
        if (result.project) {
          props.load(result.project); setLegacy(false); setRecovery({}); setNotice(copy.projectLoaded)
          if (result.project.media.some(item => item.missing)) {
            setFailed(true)
            setNotice(tr ? 'Proje açıldı. Eksik videoları medya listesinden yeniden bağla.' : 'Project opened. Relink missing videos from the media list.')
          }
        }
      }
    } catch {
      setFailed(true)
      setNotice(kind === 'relink' ? copy.relinkFailed : kind === 'recover'
        ? (tr ? 'Kurtarma kaydı okunamadı. Elle kaydettiğin projeyi Proje aç ile yükle.' : 'Recovery could not be read. Use Open project to load your saved project.')
        : copy.projectError)
    } finally {
      setDialog(false)
    }
  }

  function changeBoundary(key: 'start' | 'end', raw: string) {
    if (!clip) return
    const value = Number(raw)
    const next = { ...clip, [key]: value }
    if (raw.trim() && value === clip[key]) return
    if (raw.trim() && Number.isFinite(value) && next.start >= 0 && next.end - next.start >= 0.001 &&
        (!props.duration || media?.id !== clip.mediaId || next.end <= props.duration + .00001)) {
      setNotice('')
      update(project => ({ ...project, clips: project.clips.map(item => item.id === current ? next : item) }))
    } else {
      setFailed(true); setNotice(copy.invalidRange)
    }
  }

  function split() {
    if (!clip || clip.mediaId !== media?.id || playhead - clip.start < .001 || clip.end - playhead < .001) return
    const second = { ...clip, id: crypto.randomUUID(), start: playhead }
    update(value => ({ ...value, clips: value.clips.flatMap(item => item.id === current ? [{ ...item, end: playhead, transition: undefined }, second] : [item]) }))
    setCurrent(second.id)
  }

  function merge() {
    const index = project.clips.findIndex(item => item.id === current)
    const next = project.clips[index + 1]
    if (!clip || !next || next.mediaId !== clip.mediaId || clip.transition || JSON.stringify(clip.effects) !== JSON.stringify(next.effects) || !!clip.muteAudio !== !!next.muteAudio || Math.abs(next.start - clip.end) > .001) return
    update(value => ({ ...value, clips: value.clips.flatMap(item => item.id === current ? [{ ...item, end: next.end, transition: next.transition }] : item.id === next.id ? [] : [item]) }))
  }

  function speech(action: 'append' | 'remove') {
    if (!media || !selectedSpeech.size) return
    const ranges = [...selectedSpeech].sort((a, b) => a - b).map(index => media.cues[index]).filter(Boolean)
    update(value => {
      const clips = action === 'remove' ? subtractSpeech(value.clips, media.id, ranges)
        : [...value.clips, ...ranges.map(cue => ({ id: crypto.randomUUID(), mediaId: media.id, start: cue.start, end: cue.end }))]
      return clips.length <= 500 ? { ...value, clips } : value
    })
    setSelectedSpeech(new Set())
  }

  const position = project.clips.findIndex(item => item.id === current)
  const next = project.clips[position + 1]
  const total = layout.at(-1)?.end ?? 0
  const scale = Math.min(zoom, 24000 / Math.max(1, total))
  const width = (length: number) => Math.max(3, length * scale)
  const selected = layout[position]
  const projectTime = selected && media?.id === selected.clip.mediaId
    ? selected.start + Math.min(selected.length, Math.max(0, playhead - selected.clip.start)) : selected?.start ?? 0
  const buttons = <div className="shorts-actions project-files">
    <button className="primary" disabled={dialog || project.media.length >= 100} onClick={() => void projectDialog('add')}>{copy.addProjectMedia}</button>
    <button className="export-cancel" disabled={dialog} onClick={() => void projectDialog('open')}>{copy.openProject}</button>
    <button className="export-cancel" disabled={dialog || (!project.media.length && !project.timeline)} onClick={() => void projectDialog('save')}>{copy.saveProject}</button>
    <button className="export-cancel" aria-pressed={!!layered} onClick={() => {
      stop()
      if (layered) setLegacy(true)
      else {
        setLegacy(false)
        if (!project.timeline) {
          update(value => ({ ...value, version: 2, timeline: layerFromLegacy(value) }))
          setNotice(tr ? 'Katmanlar oluşturuldu. Önceki kurgu eski düzen görünümünde korunur.' : 'Layers created. The original edit is available in the legacy view.')
        }
      }
    }}>{layered ? (tr ? 'Eski düzen' : 'Legacy sequence') : (tr ? 'Katmanlı düzen' : 'Multitrack editor')}</button>
    {recovery.available && <button className="export-cancel" disabled={dialog} onClick={() => void projectDialog('recover')}>{copy.recoverProject}</button>}
    {recovery.available && <button className="export-cancel" disabled={dialog} onClick={() => setRecovery({})}>{tr ? 'Bu oturumda atla' : 'Skip for this session'}</button>}
    {recovery.damaged && <span role="alert">{tr ? 'Otomatik kayıt okunamadı. Kayıtlı projeyi elle açabilirsin.' : 'Autosave could not be read. You can open a saved project.'}</span>}
    {autosaveInterval > 0 && saved === project && <span>{copy.autosaved}</span>}
    {autosaveInterval > 0 && autosaveFailed && <span role="alert">{copy.autosaveFailed}</span>}
  </div>

  return <section className="panel project-panel" aria-label={copy.projectHeading} onKeyDown={event => {
    if (!(event.target instanceof Element) || !event.target.closest('.sequence-strip button') || !clip || event.repeat) return
    if (event.key === 'Delete') {
      event.preventDefault(); stop(); update(value => ({ ...value, clips: value.clips.filter(item => item.id !== current) }))
    } else if (event.key.toLowerCase() === 's' && !event.ctrlKey && !event.altKey && !event.metaKey && project.clips.length < 500) {
      event.preventDefault(); split()
    }
  }}>
    <header className="panel-header"><h2>{copy.projectHeading}</h2><span>{timecode(layered ? layerDuration(layered) / layered.fps : total)}</span></header>
    <div className="project-body">
      {buttons}
      {!project.media.length && <p>{copy.projectEmpty}</p>}
      {project.media.filter(entry => entry.missing).map(entry => <div className="shorts-actions" key={entry.id}>
        <span>{copy.missingProjectMedia} · {entry.name}</span><button className="export-cancel" disabled={dialog}
          onClick={() => void projectDialog('relink', entry.id)}>{copy.relinkMedia}</button>
      </div>)}
      {notice && <p role={failed ? 'alert' : 'status'}>{notice}</p>}
      {layered && <LayeredTimeline key={props.projectEpoch} project={project} copy={copy} tr={tr} inspector={props.settingsHost} monitor={props.monitorHost}
        undo={props.undo} redo={props.redo} history={props.history} change={update} waveforms={props.waveforms} stop={stop} />}
      {!layered && !!project.media.length && <>
        <div className="shorts-actions">
          <button className="export-cancel" disabled={!props.undo} onClick={() => props.history('undo')}>{copy.undo}</button>
          <button className="export-cancel" disabled={!props.redo} onClick={() => props.history('redo')}>{copy.redo}</button>
          <button className="export-cancel" disabled={!project.clips.length} onClick={playback ? stop : play}>{playback ? copy.pause : copy.playSequence}</button>
          <button className="export-cancel" onClick={props.openSource}>{copy.studioSource}</button>
          <label>{copy.zoom}<input aria-label={copy.sequenceZoom} type="range" min="25" max="200" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
          <button className="export-cancel" disabled={!media || !props.duration || project.clips.length >= 500} onClick={() => {
            if (!media) return
            const next = { ...props.range, mediaId: media.id, id: crypto.randomUUID() }
            update(value => ({ ...value, clips: [...value.clips, next] })); setCurrent(next.id)
          }}>{copy.addSelection}</button>
        </div>
        <div className="studio-tracks">
          <div className="track-labels"><span>{copy.videoTrack}</span><span>{copy.studioAudio}</span><span>{copy.studioSubtitles}</span></div>
          <div className="track-scroll" tabIndex={0} aria-label={copy.studioTracks}>
          <div className="sequence-strip" aria-label={copy.sequenceTrack}>
          {layout.map(({clip: item, source, length, overlap},index) => <button key={item.id} type="button" draggable aria-pressed={item.id === current}
            title={source?.name} style={{ width: width(length - overlap) }}
            onDragStart={e => { setDragged(index); e.dataTransfer.setData('text/plain', item.id) }}
            onDragEnd={() => setDragged(undefined)} onDragOver={e => { if (dragged !== undefined) e.preventDefault() }}
            onDrop={e => {
              e.preventDefault(); if (dragged !== undefined && dragged !== index) {
                stop(); update(value => ({ ...value, clips: moveClip(value.clips, dragged, index) }))
              }
              setDragged(undefined)
            }} onClick={() => select(item)}>
            <strong>{index + 1}. {source?.name}</strong>
            <span>{timecode(item.start)} – {timecode(item.end)}{item.transition && index < layout.length - 1 && ' · ' + copy.fxTransitions[item.transition.kind]}</span>
          </button>)}
          </div>
          <div className="track-lane audio-lane" aria-label={copy.studioAudio}>
            {layout.map(({clip, length: fullLength, overlap, source}) => {
              const length = fullLength - overlap
              const waveform = !clip.muteAudio ? props.waveforms?.[clip.mediaId] : undefined
              const count = Math.max(2, Math.min(180, Math.round(width(length) / 3)))
              const bars = waveform?.peaks.length ? Array.from({ length: count }, (_, index) =>
                waveform.peaks[Math.floor((clip.start + index * length / count) / waveform.step)] ?? 0) : undefined
              return <button type="button" key={clip.id} style={{ width: width(length) }} className={clip.muteAudio ? 'muted-clip' : undefined}
                title={clip.muteAudio ? copy.clipMuted : source?.name} aria-label={copy.studioAudio + ' · ' + source?.name} onClick={() => select(clip)}>
                {bars?.map((peak, index) => <i key={index} style={{ height: Math.max(1, peak * 21) }} />)}
              </button>
            })}
          </div>
          <div className="track-lane caption-lane" aria-label={copy.studioSubtitles}>
            {layout.map(({clip, length: fullLength, overlap, start, captions}) => {
              const length = fullLength - overlap
              return <div key={clip.id} style={{ width: width(length) }}>
              {captions.filter(cue => width(length) * (cue.to - cue.from) / length >= 3).slice(0, 200).map((cue, index) => <button type="button" key={index} title={cue.text}
                style={{ left: (cue.from - start) / length * 100 + '%', width: Math.max(1, (cue.to - cue.from) / length * 100) + '%' }}
                onClick={() => props.seekProject(clip, clip.start + cue.from - start)}>{cue.text}</button>)}
            </div>})}
          </div>
          </div>
        </div>
        {total > 0 && <label className="project-playhead">{timecode(projectTime)}
          <input type="range" min={0} max={total} step={0.01} value={projectTime} aria-label={copy.sequenceTrack}
            onChange={event => {
              const time = Number(event.target.value)
              const segment = layout.find(item => time < item.end) ?? layout.at(-1)
              if (segment) props.seekProject(segment.clip, segment.clip.start + Math.min(segment.length, time - segment.start))
            }} /></label>}
        <p>{copy.studioRules}</p>
        {clip && <div className="shorts-actions">
          {(['start', 'end'] as const).map(key => <label key={key}>{copy[key]}<input aria-label={copy[key] + ' · ' + copy.sequenceTrack}
            key={clip.id + key + clip[key]} type="number" min="0" step=".001" defaultValue={Number(clip[key].toFixed(3))}
            onBlur={e => { changeBoundary(key, e.target.value); e.target.value = String(Number(clip[key].toFixed(3))) }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>)}
          <button className="export-cancel" disabled={media?.id !== clip.mediaId || playhead <= clip.start || playhead >= clip.end || project.clips.length >= 500} onClick={split}>{copy.splitClip}</button>
          <button className="export-cancel" onClick={() => update(value => ({ ...value, clips: value.clips.filter(item => item.id !== current) }))}>{copy.deleteClip}</button>
          <button className="export-cancel" disabled={next?.mediaId !== clip.mediaId || !!clip.transition || JSON.stringify(clip.effects) !== JSON.stringify(next?.effects) || !!clip.muteAudio !== !!next?.muteAudio || Math.abs((next?.start ?? -10) - clip.end) > .001} onClick={merge}>{copy.mergeClips}</button>
          {[-1, 1].map(step => <button key={step} className="export-cancel" disabled={position + step < 0 || position + step >= project.clips.length}
            onClick={() => update(value => ({ ...value, clips: moveClip(value.clips, position, position + step) }))}>{step < 0 ? copy.clipEarlier : copy.clipLater}</button>)}
        </div>}
        {!!speechCues.length && props.speechHost && createPortal(<section className="panel speech-project" aria-label={copy.speechEdit}>
          <h3>{copy.speechEdit}</h3><p>{copy.speechHelp}</p>
          <div className="speech-list">{speechCues.slice(speechPage * 20, speechPage * 20 + 20).map((cue, offset) => {
            const index = speechPage * 20 + offset
            return <div key={index}><label><input type="checkbox" aria-label={cue.text} checked={selectedSpeech.has(index)} onChange={e => {
              const next = new Set(selectedSpeech); if (e.target.checked) next.add(index); else next.delete(index); setSelectedSpeech(next)
            }} /></label><button className="speech-jump" type="button" title={copy.selectSpeechRange}
              onClick={() => { stop(); props.selectSpeech(cue) }}>{timecode(cue.start)} · {cue.text}</button></div>
          })}</div>
          <div className="shorts-actions">
            <button className="export-cancel" disabled={!selectedSpeech.size} onClick={() => speech('append')}>{copy.appendSpeech}</button>
            <button className="export-cancel" disabled={!selectedSpeech.size} onClick={() => speech('remove')}>{copy.removeSpeech}</button>
            <button className="export-cancel" disabled={!speechPage} onClick={() => setSpeechPage(speechPage - 1)}>{copy.previousPage}</button>
            <button className="export-cancel" disabled={(speechPage + 1) * 20 >= speechCues.length} onClick={() => setSpeechPage(speechPage + 1)}>{copy.nextPage}</button>
          </div>
        </section>, props.speechHost)}
        {props.settingsHost && createPortal(<section className="panel studio-project-settings" aria-label={copy.studioInspector}>
        <header className="panel-header"><h2>{copy.studioInspector} · {copy.projectHeading}</h2></header>
        <div className="project-body">
        {clip && next && <div className="auto-settings">
          <label>{copy.fxTransition}<select aria-label={copy.fxTransition} value={clip.transition?.kind ?? 'none'} onChange={event => {
            const kind = event.target.value as 'none' | 'fade' | 'dissolve' | 'slideleft'
            update(value => ({ ...value, clips: value.clips.map(item => item.id === clip.id ? { ...item,
              transition: kind === 'none' ? undefined : { kind, duration: clip.transition?.duration ?? .5 } } : item) }))
          }}>{Object.entries(copy.fxTransitions).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select></label>
          {clip.transition && <label>{copy.fxTransitionDuration}<input type="number" min=".15" max="1.5" step=".05"
            key={clip.transition.duration} defaultValue={clip.transition.duration} onBlur={event => {
              const duration = Number(event.target.value)
              if (!Number.isFinite(duration) || duration < .15 || duration > 1.5) { event.target.value = String(clip.transition?.duration); return }
              update(value => ({ ...value, clips: value.clips.map(item => item.id === clip.id && item.transition ? { ...item,
                transition: { ...item.transition, duration } } : item) }))
            }} /></label>}
        </div>}
        {clip?.transition && next && <TransitionMonitor key={clip.id + ':' + next.id + ':' + clip.transition.kind + ':' + clip.transition.duration}
          project={project} clip={clip} next={next} copy={copy} />}
        {clip && <label><input type="checkbox" checked={!!clip.muteAudio} onChange={event => {
          const muteAudio = event.target.checked
          update(value => ({ ...value, clips: value.clips.map(item => item.id === clip.id ? { ...item, muteAudio } : item) }))
        }} />{copy.muteClip}</label>}
        <ProfileFields profile={project.profile} set={props.setProfile} copy={copy} />
        <div className="project-controls">
          <label>{copy.encodingMode}<select aria-label={copy.projectEncoder} value={project.encoder} onChange={e => update(value => ({ ...value, encoder: e.target.value as Project['encoder'] }))}>
            <option value="auto">{copy.encodingAuto}</option><option value="cpu">CPU</option></select></label>
          <label><input type="checkbox" checked={project.burn} onChange={e => update(value => ({ ...value, burn: e.target.checked }))} />{copy.burnSubtitles}</label>
        </div>
        <div className="shorts-actions">
          {media && !!props.removals.length && <button className="export-cancel" onClick={() => update(value => {
            const clips = subtractSpeech(value.clips, media.id, props.removals)
            return clips.length <= 500 ? { ...value, clips } : value
          })}>{copy.applyProjectSilence}</button>}
          {project.frame && <span>{copy.projectFrame} · {{ vertical: '9:16', square: '1:1', landscape: '16:9' }[project.frame.mode]}</span>}
          {props.framing && <button className="export-cancel" onClick={() => update(value => ({ ...value, frame: props.framing }))}>{copy.frameProject}</button>}
          {project.frame && <button className="export-cancel" onClick={() => update(value => ({ ...value, frame: undefined }))}>{copy.clearProjectFrame}</button>}
        </div>
        <SequenceExport project={project} copy={copy} />
        </div></section>, props.settingsHost)}
      </>}
    </div>
  </section>
}
