import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import {
  AlertCircle, CircleHelp, ClosedCaption, Film, FolderOpen, Globe2, HardDrive,
  MonitorPlay, Pause, Play, SkipBack, SkipForward, SlidersHorizontal, Upload, Volume2, VolumeX, X,
} from 'lucide-react'
import { loadLanguage, messages } from './i18n'
import type { Language } from './i18n'
import { Timeline } from './editor/Timeline'
import { sizeLabel, subtitleStyles, timecode } from './editor/model'
import type { ClipRange, SubtitleStyle } from './editor/model'
import { ShortsPanel } from './editor/ShortsPanel'
import { AutoShortsPanel } from './editor/AutoShortsPanel'
import { DirectorPanel } from './editor/DirectorPanel'
import { EffectsPanel } from './editor/EffectsPanel'
import { zoomAt } from './editor/effects'
import type { StudioEffects } from './editor/effects'
import { frameX, sizes } from './editor/shorts'
import type { Edit, Frame } from './editor/shorts'
import { useVideo } from './editor/useVideo'
import { ExportPanel } from './export/ExportPanel'
import { SubtitlePanel } from './subtitles/SubtitlePanel'
import { CaptionPreview } from './subtitles/CaptionPreview'
import { CoverStudio } from './editor/CoverStudio'
import { Diagnostics } from './editor/Diagnostics'
import { PerformanceCenter } from './editor/PerformanceCenter'
import { CopilotPanel } from './editor/CopilotPanel'
import { CreatorPanel } from './editor/CreatorPanel'
import { BetaSettings } from './editor/BetaSettings'
import type { BetaPreferences } from './editor/BetaSettings'
import type { CreatorIntent } from './editor/CreatorPanel'
import { StudioDivider } from './editor/StudioDivider'
import { defaultAppearance } from './subtitles/model'
import type { Appearance, Cue } from './subtitles/model'
import { createCueLookup } from './subtitles/lookup'
import { ProjectPanel } from './project/ProjectPanel'
import { MediaLibrary } from './project/MediaLibrary'
import { MediaPreparation } from './project/MediaPreparation'
import { defaultLayout, defaultProfile, historyReducer, linkedFiles } from './project/model'
import type { Project, ProjectClip, ProjectMedia, ProxyResolution, Waveform, WorkspaceLayout } from './project/model'
import { layerFromLegacy } from './project/layer-model'
import { appendApprovedShorts } from './editor/approved-shorts'
import type { ApprovedShorts } from './editor/approved-shorts'

const emptyCues: Cue[] = []
const AudioInspector = lazy(() => import('./editor/AudioInspector').then(module => ({ default: module.AudioInspector })))

async function mediaDuration(id: string) {
  const video = document.createElement('video')
  video.preload = 'metadata'
  try {
    return await new Promise<number>(resolve => {
      const timer = window.setTimeout(() => resolve(0), 8000)
      const finish = (value: number) => { clearTimeout(timer); resolve(value) }
      video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.videoWidth > 0 ? video.duration : 0)
      video.onerror = () => finish(0)
      video.src = '/project-media/' + id
    })
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}

export function App() {
  const editor = useVideo()
  const { source, metadata, element, playing, muted, time, range, error } = editor
  const [language, setLanguage] = useState<Language>(loadLanguage)
  const [style, setStyle] = useState<SubtitleStyle>('classic')
  const [showSample, setShowSample] = useState(true)
  const [dragging, setDragging] = useState(false)
  const desktop = !!window.viralCutDesktop
  const [studioTab, setStudioTab] = useState<'media' | 'subtitles' | 'audio' | 'ai' | 'effects' | 'cover' | 'director' | 'performance' | 'copilot' | 'creator' | 'settings' | 'hub'>('media')
  const [beta, setBeta] = useState<BetaPreferences>()
  const [version, setVersion] = useState('23.0.0')
  const [workspace, setWorkspace] = useState<'easy' | 'professional' | 'ai'>('easy')
  const [legacyView, setLegacyView] = useState(false)
  const [creatorIntent, setCreatorIntent] = useState<CreatorIntent>()
  const [copilotProject, setCopilotProject] = useState(0)
  const [safeGuides, setSafeGuides] = useState(false)
  const [layout, setLayout] = useState(defaultLayout)
  const [layoutReady, setLayoutReady] = useState(false)
  const [layoutError, setLayoutError] = useState(false)
  const projectBridge = window.viralCutDesktop?.projects
  const flushLayout = useCallback(async () => {
    if (layoutReady && projectBridge) await projectBridge.saveLayout(layout)
  }, [layout, layoutReady, projectBridge])
  const [hubHost, setHubHost] = useState<HTMLDivElement | null>(null)
  const changeLayout = (patch: Partial<WorkspaceLayout>) => setLayout(previous => ({ ...previous, ...patch }))
  useEffect(() => {
    let active = true
    void projectBridge?.workspace().then(data => {
      if (active && data.layout) { setLayout(data.layout); setLayoutReady(true) }
    }).catch(() => { if (active) setLayoutError(true) })
    return () => { active = false }
  }, [projectBridge])
  useEffect(() => {
    if (!layoutReady) return
    const timer = window.setTimeout(() => {
      void projectBridge?.saveLayout(layout).then(result => setLayoutError(!result.saved)).catch(() => setLayoutError(true))
    }, 150)
    return () => window.clearTimeout(timer)
  }, [layoutReady, layout, projectBridge])
  const [sourceTab, setSourceTab] = useState(false)
  const [monitorHost, setMonitorHost] = useState<HTMLDivElement | null>(null)
  const [effectHost,setEffectHost]=useState<HTMLDivElement|null>(null)
  const [layerSelected,setLayerSelected]=useState('')
  const [settingsHost, setSettingsHost] = useState<HTMLDivElement | null>(null)
  const [speechHost, setSpeechHost] = useState<HTMLDivElement | null>(null)
  const [waveforms, setWaveforms] = useState<Record<string, Waveform>>({})
  const [proxyId, setProxyId] = useState<{ id: string; height: ProxyResolution }>()
  const [proxyFallback, setProxyFallback] = useState<string>()
  const [sourceEffects, setSourceEffects] = useState<{ url: string; current?: StudioEffects; history: (StudioEffects | undefined)[] }>()
  const [compare, setCompare] = useState(false)
  const [autoMedia, setAutoMedia] = useState<{ media: ProjectMedia; duration: number }>()
  const [autoPreview, setAutoPreview] = useState<{ id: string; range: ClipRange; cues: Cue[]; appearance: Appearance; frame: Frame; remove: ClipRange[]; effects?: StudioEffects }>()
  const autoPending = useRef<string | null>(null)
  const proxySeek = useRef<{ url: string; seconds: number } | null>(null)
  const storeWaveform = useCallback((id: string, value: Waveform) => setWaveforms(current =>
    current[id] ? current : { ...current, [id]: value }), [])
  const [history, dispatch] = useReducer(historyReducer, {
    previous: [], next: [], present: {
      version: 1, media: [], clips: [], appearance: defaultAppearance, profile: defaultProfile, encoder: 'auto', burn: true,
    },
  })
  const project = history.present
  const appearance = project.appearance
  const setAppearance = (appearance: Project['appearance']) => updateProject(value => ({ ...value, appearance }))
  const [currentClip, setCurrentClip] = useState('')
  const [sequencePlaying, setSequencePlaying] = useState(false)
  const sequence = useRef<{ clips: ProjectClip[]; index: number; waiting: boolean } | null>(null)
  const pending = useRef<{ clip: ProjectClip; play: boolean; seconds?: number } | null>(null)
  const sourceChange = useRef(0)
  const mountedSource = source && linkedFiles.get(source.file)
  const projectMedia = mountedSource ? project.media.find(item => item.id === mountedSource.id) : undefined
  const selectedProjectClip = project.clips.find(clip => clip.id === currentClip && clip.mediaId === projectMedia?.id)
  const effects = selectedProjectClip ? selectedProjectClip.effects : sourceEffects?.url === source?.url ? sourceEffects?.current : undefined
  const usingProxy = projectMedia && proxyId?.id === projectMedia.id ? proxyId : undefined
  const videoUrl = usingProxy ? '/preview-media/' + usingProxy.id + '/' + usingProxy.height : source?.url
  const [captionTrack, setCaptionTrack] = useState<{ file: File | undefined; cues: Cue[] }>()
  const [shorts, setShorts] = useState<{ file?: File; edit?: Edit; markers?: ClipRange[]; preview?: boolean }>({})
  const candidateEnd = useRef<number>(null)
  const edit = (shorts.file === source?.file && shorts.edit) || { remove: [], encoder: 'auto' as const }
  const silenceMarkers = shorts.file === source?.file ? shorts.markers ?? [] : []
  const activeAuto = autoPreview?.id === mountedSource?.id ? autoPreview : undefined
  const afterPreview = shorts.file === source?.file && shorts.preview === true
  const frame = activeAuto?.frame ?? (afterPreview ? edit.frame : selectedProjectClip ? project.frame : undefined)
  const previewRemovals = activeAuto?.remove ?? (afterPreview ? edit.remove : undefined)
  const ratio = frame ? sizes[frame.mode][0] / sizes[frame.mode][1] : 1
  const sourceRatio = metadata ? metadata.width / metadata.height : ratio
  const viewWidth = frame?.fit === 'contain' ? Math.min(1, sourceRatio / ratio) : frame ? Math.max(1, sourceRatio / ratio) * frame.zoom : 1
  const viewHeight = frame?.fit === 'contain' ? Math.min(1, ratio / sourceRatio) : frame ? Math.max(1, ratio / sourceRatio) * frame.zoom : 1
  const visibleEffects = activeAuto ? activeAuto.effects : compare ? undefined : effects
  const previewZoom = zoomAt(visibleEffects?.zoom, time, visibleEffects?.zoomReturn)
  const visualFilter = visibleEffects && `brightness(${1 + (visibleEffects.brightness ?? 0)}) contrast(${visibleEffects.contrast ?? 1}) saturate(${visibleEffects.saturation ?? 1})`
  const videoStyle = { ...(frame ? {
    width: 100 * viewWidth + '%', height: 100 * viewHeight + '%',
    left: (1 - viewWidth) * 50 * (frameX(frame, time) + 1) + '%',
    top: (1 - viewHeight) * 50 * (frame.y + 1) + '%',
  } : {}), transform: previewZoom !== 1 ? `scale(${previewZoom})` : undefined, filter: visualFilter }
  const cues = projectMedia?.cues ?? (captionTrack?.file === source?.file ? captionTrack?.cues : undefined) ?? emptyCues
  const previewCues = activeAuto?.cues ?? cues
  const previewAppearance = activeAuto?.appearance ?? appearance
  const fitCaption = !frame && !!metadata && (safeGuides || previewAppearance.safe || previewAppearance.motion !== undefined)
  const previewStyle = frame || fitCaption ? { '--frame-ratio': frame ? ratio : sourceRatio } as CSSProperties : undefined
  const lookup = useMemo(() => createCueLookup(previewCues), [previewCues])
  const activeCues = lookup(time)
  const overlay = useMemo(() => {
    const visibleCues = cues.filter(cue => cue.text.trim())
    return visibleCues.length ? { cues: visibleCues, appearance } : undefined
  }, [cues, appearance])
  const dragDepth = useRef(0)
  const picker = useRef<HTMLInputElement>(null)
  const copy = messages[language]
  const singleExport = <ExportPanel file={source?.file} range={range} enabled={!!metadata} copy={copy} effects={effects}
    edit={edit.frame || edit.remove.length || edit.encoder === 'cpu' ? edit : undefined}
    overlay={overlay} />

  function updateProject(apply: (value: Project) => Project) { dispatch({ type: 'update', apply }) }

  function updateEffects(next?: StudioEffects) {
    if (selectedProjectClip) updateProject(value => ({ ...value, clips: value.clips.map(clip => clip.id === selectedProjectClip.id ? { ...clip, effects: next } : clip) }))
    else if (source) setSourceEffects({ url: source.url, current: next,
      history: [...(sourceEffects?.url === source.url ? sourceEffects.history.slice(-29) : []), effects] })
  }

  function undoEffects() {
    if (selectedProjectClip) { stopSequence(); dispatch({ type: 'undo' }); return }
    if (sourceEffects?.url === source?.url && sourceEffects?.history.length) setSourceEffects({ ...sourceEffects,
      current: sourceEffects.history.at(-1), history: sourceEffects.history.slice(0, -1) })
  }

  function stopSequence() {
    sequence.current = null
    if (pending.current) pending.current.play = false
    setSequencePlaying(false)
    element.current?.pause()
  }

  function stopAutoPreview() {
    if (autoPreview) element.current?.pause()
    autoPending.current = null
    setAutoPreview(undefined)
  }

  async function chooseAutoSource(media: ProjectMedia) {
    const request = ++sourceChange.current
    stopSequence(); stopAutoPreview()
    pending.current = null
    proxySeek.current = null
    setProxyId(undefined)
    editor.openLinked(media)
    const duration = await mediaDuration(media.id)
    if (request === sourceChange.current) setAutoMedia({ media, duration })
  }

  function previewAutoClip(range: ClipRange, cues: Cue[], appearance: Appearance, frame: Frame, remove: ClipRange[], effects?: StudioEffects,
    entry = autoMedia?.media) {
    if (!entry) return
    stopSequence()
    autoPending.current = entry.id
    setAutoPreview({ id: entry.id, range, cues, appearance, frame, remove, effects })
    if (entry.id !== mountedSource?.id) {
      pending.current = null; proxySeek.current = null; setProxyId(undefined); editor.openLinked(entry)
    }
  }

  const startAuto = useEffectEvent(() => {
    if (!metadata || !activeAuto || autoPending.current !== activeAuto.id) return
    autoPending.current = null
    editor.selectRange(activeAuto.range)
    editor.seek(activeAuto.range.start)
    candidateEnd.current = activeAuto.range.end
    void element.current?.play().catch(() => editor.setError('playFailed'))
  })
  useEffect(() => { startAuto() }, [metadata, activeAuto])

  function selectProxy(height?: ProxyResolution) {
    if (!projectMedia || !source || !metadata) return
    proxySeek.current = { url: source.url, seconds: element.current?.currentTime ?? time }
    stopSequence()
    setProxyFallback(undefined)
    setProxyId(height ? { id: projectMedia.id, height } : undefined)
  }

  function switchWorkspace(next: typeof workspace) {
    changeLayout({ library: true, tracks: true })
    setSourceTab(false)
    stopAutoPreview()
    stopSequence()
    setWorkspace(next)
    if (next === 'ai') {
      if (!autoMedia && mountedSource && metadata) setAutoMedia({ media: projectMedia ?? mountedSource, duration: metadata.duration })
      setStudioTab('ai')
      return
    }
    setStudioTab('media')
    setLegacyView(next === 'easy')
    if (next === 'professional') updateProject(value =>
      value.timeline ? value : { ...value, version: 2, timeline: layerFromLegacy(value) })
  }

  function applyShorts(media: ProjectMedia, plan: ApprovedShorts) {
    const next = appendApprovedShorts(project, media, plan)
    if (!next) return false
    switchWorkspace('easy')
    updateProject(current => current === project ? next : current)
    setSourceTab(false)
    positionClip(next.clips[project.clips.length], false, next.media)
    return true
  }

  function positionClip(clip: ProjectClip, play: boolean, media = project.media, seconds = clip.start) {
    if (autoPreview) stopAutoPreview()
    candidateEnd.current = null
    const entry = media.find(item => item.id === clip.mediaId)
    if (!entry || entry.missing) return false
    setCurrentClip(clip.id)
    if (mountedSource?.id === entry.id && metadata) {
      editor.selectRange(clip)
      editor.seek(seconds)
      if (play) void element.current?.play().catch(stopSequence)
      return true
    }
    pending.current = { clip, play, seconds }
    proxySeek.current = null
    setProxyId(undefined)
    editor.openLinked(entry)
    return true
  }

  async function addProjectMedia(entries: ProjectMedia[]) {
    const accepted = entries.slice(0, Math.max(0, 100 - project.media.length))
    const clips: ProjectClip[] = []
    for (const entry of accepted) {
      const duration = await mediaDuration(entry.id)
      if (duration > 0.001 && clips.length + project.clips.length < 500) {
        clips.push({ id: crypto.randomUUID(), mediaId: entry.id, start: 0, end: duration })
      }
    }
    if (!clips.length) { editor.setError('decode'); return }
    const added = accepted.filter(entry => clips.some(clip => clip.mediaId === entry.id))
    updateProject(value => ({ ...value, media: [...value.media, ...added], clips: [...value.clips, ...clips] }))
    setSourceTab(false)
    if (!project.clips.length) positionClip(clips[0], false, added)
    if (added.length < accepted.length) editor.setError('decode')
  }

  function loadProject(value: Project) {
    setLegacyView(false)
    setWorkspace(value.timeline ? 'professional' : 'easy')
    sourceChange.current++
    setCopilotProject(value => value + 1)
    stopSequence()
    stopAutoPreview()
    setAutoMedia(undefined)
    pending.current = null
    proxySeek.current = null
    setProxyId(undefined)
    dispatch({ type: 'load', state: value })
    setSourceTab(false)
    setCurrentClip('')
    setShorts({})
    editor.clearSource()
    const first = value.clips.find(clip => !value.media.find(media => media.id === clip.mediaId)?.missing)
    if (first) {
      pending.current = { clip: first, play: false }
      const entry = value.media.find(media => media.id === first.mediaId)
      if (entry) { setCurrentClip(first.id); editor.openLinked(entry) }
    }
  }

  function playSequence() {
    if (project.clips.some(clip => project.media.find(item => item.id === clip.mediaId)?.missing)) return
    const index = Math.max(0, project.clips.findIndex(clip => clip.id === currentClip))
    if (!project.clips[index]) return
    sequence.current = { clips: project.clips, index, waiting: false }
    setSequencePlaying(true)
    if (!positionClip(project.clips[index], true)) stopSequence()
  }

  const applyPending = useEffectEvent(() => {
    const item = pending.current
    if (!item || !metadata || mountedSource?.id !== item.clip.mediaId) return
    pending.current = null
    if (item.clip.end > metadata.duration + .05) { stopSequence(); editor.setError('invalidRange'); return }
    editor.selectRange({ start: item.clip.start, end: Math.min(metadata.duration, item.clip.end) })
    editor.seek(item.seconds ?? item.clip.start)
    if (sequence.current) sequence.current.waiting = false
    if (item.play) void element.current?.play().catch(stopSequence)
  })
  useEffect(() => { applyPending() }, [metadata, source])

  const advanceSequence = useEffectEvent((video: HTMLVideoElement, ended = false) => {
    const active = sequence.current
    if (!active || active.waiting || (!ended && video.currentTime < active.clips[active.index].end)) return
    const next = active.clips[++active.index]
    if (!next) { stopSequence(); return }
    active.waiting = mountedSource?.id !== next.mediaId
    if (!positionClip(next, true)) stopSequence()
  })
  useEffect(() => {
    if (!sequencePlaying) return
    let frame = 0
    const tick = () => {
      if (element.current && !element.current.paused) advanceSequence(element.current)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [sequencePlaying, element])

  useEffect(() => {
    if (!playing || sequencePlaying) return
    let request = 0
    const tick = () => {
      const video = element.current
      if (!video) return
      if (candidateEnd.current !== null && video.currentTime >= candidateEnd.current) {
        candidateEnd.current = null
        video.pause()
        return
      }
      const cut = previewRemovals?.find(span => video.currentTime >= span.start && video.currentTime < span.end)
      if (cut && !video.seeking) video.currentTime = Math.min(cut.end, video.duration)
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [previewRemovals, element, playing, sequencePlaying, source])

  function useCandidate(span: ClipRange) {
    stopAutoPreview()
    candidateEnd.current = null
    editor.selectRange(span)
    editor.seek(span.start)
  }

  function playCandidate(span: ClipRange) {
    useCandidate(span)
    candidateEnd.current = span.end
    if (element.current?.paused) void editor.togglePlayback()
  }

  useEffect(() => {
    void window.viralCutDesktop?.beta.read().then(result => {
      if (result.settings) { setBeta(result.settings); setLanguage(result.settings.language) }
      if (result.version) setVersion(result.version)
    }).catch(() => {})
  }, [])
  useEffect(() => {
    document.documentElement.lang = language
    try {
      localStorage.setItem('viralcut.language', language)
    } catch {
      // The current session can still switch languages.
    }
  }, [language])

  function detachPreview(clear = true) {
    sourceChange.current++
    stopSequence()
    stopAutoPreview()
    pending.current = null
    proxySeek.current = null
    setProxyId(undefined)
    setAutoMedia(undefined)
    setCurrentClip('')
    setSourceTab(true)
    if (clear) { editor.clearSource(); editor.setError(null) }
  }

  function openPreview(files: FileList | null) {
    if (!files?.length) return
    if (files.length === 1 && files[0].size > 0 && /\.(mp4|webm)$/i.test(files[0].name)) detachPreview(false)
    void editor.open(files)
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    openPreview(event.dataTransfer.files)
  }

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable]')) return
    if (event.repeat || event.altKey) return
    if (desktop && (event.ctrlKey || event.metaKey)) {
      const key = event.key.toLowerCase()
      if (key === 'z' || key === 'y') {
        event.preventDefault(); stopSequence()
        dispatch({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' })
      }
      return
    }
    if (event.code !== 'Space' || event.ctrlKey || event.metaKey) return
    if (event.target instanceof Element && event.target.closest('button, a')) return
    if (!metadata) return
    event.preventDefault()
    if (sequence.current) stopSequence()
    else void editor.togglePlayback()
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleShortcut(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className={'app' + (desktop ? ' studio' : '')}
      data-theme={layout.theme} data-library={layout.library} data-inspector={layout.inspector} data-tracks={layout.tracks}
      style={desktop ? { '--studio-left': layout.left + 'px', '--studio-right': layout.right + 'px', '--studio-timeline': layout.timeline + 'px' } as CSSProperties : undefined}
      onDragOver={event => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDrop={event => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}>
      <header className="topbar">
        <div className="brand">
          <img src={import.meta.env.BASE_URL + 'viralcut.svg'} alt="" width="38" height="38" />
          <div><strong>ViralCut <em>AI</em></strong><span>{desktop ? 'v' + version.replace(/-beta$/, ' Beta') : 'DESKTOP'}</span></div>
        </div>
        {desktop && <nav className="workspace-modes locale" aria-label={language === 'tr' ? 'Çalışma alanı' : 'Workspace'}>
          <button type="button" aria-pressed={workspace === 'easy'} onClick={() => switchWorkspace('easy')}>
            {language === 'tr' ? 'Kolay Editör' : 'Easy Editor'}</button>
          <button type="button" aria-pressed={workspace === 'professional'} onClick={() => switchWorkspace('professional')}>
            {language === 'tr' ? 'Profesyonel Editör' : 'Professional Editor'}</button>
          <button type="button" aria-pressed={workspace === 'ai'} onClick={() => switchWorkspace('ai')}>
            {language === 'tr' ? 'AI Stüdyo' : 'AI Studio'}</button>
        </nav>}
        <div className="top-actions">
          {desktop && <button className="export-cancel" onClick={() => { changeLayout({ library: true }); setStudioTab('hub') }}>{language === 'tr' ? 'Projeler' : 'Projects'}</button>}
          {desktop && <details className="layout-menu">
            <summary aria-label={language === 'tr' ? 'Panel düzeni' : 'Panel layout'}><SlidersHorizontal size={16} /></summary>
            <div className="panel layout-popover">
              <label>{language === 'tr' ? 'Tema' : 'Theme'} <select value={layout.theme} onChange={event => changeLayout({ theme: event.target.value === 'light' ? 'light' : 'dark' })}>
                <option value="dark">{language === 'tr' ? 'Koyu' : 'Dark'}</option><option value="light">{language === 'tr' ? 'Açık' : 'Light'}</option>
              </select></label>
              {([['library', copy.studioMedia], ['inspector', copy.studioInspector], ['tracks', copy.timeline]] as const).map(([key, label]) =>
                <label key={key}><input type="checkbox" checked={layout[key]} onChange={event => changeLayout({ [key]: event.target.checked })} />{label}</label>)}
              <button className="export-cancel" onClick={() => setLayout({ ...defaultLayout, theme: layout.theme })}>{language === 'tr' ? 'Düzeni sıfırla' : 'Reset layout'}</button>
              {layoutError && <p role="alert">{language === 'tr' ? 'Düzen tercihleri kaydedilemedi.' : 'Layout preferences could not be saved.'}</p>}
            </div>
          </details>}
          <div className="locale" role="group" aria-label={copy.language}>
            <Globe2 size={15} aria-hidden="true" />
            {(['tr', 'en'] as const).map(value => <button key={value} type="button" lang={value} aria-label={value === 'tr' ? 'Türkçe' : 'English'}
              aria-pressed={language === value} onClick={() => {
                setLanguage(value)
                if (beta) {
                  const next = { ...beta, language: value }
                  setBeta(next)
                  void window.viralCutDesktop?.beta.save(next).catch(() => setLayoutError(true))
                }
              }}>{value.toUpperCase()}</button>)}
          </div>
          <button type="button" className="primary" onClick={() => picker.current?.click()}>
            <FolderOpen size={17} />{copy.open}
          </button>
          <input ref={picker} type="file" accept=".mp4,.webm,video/mp4,video/webm" hidden
            onChange={event => {
              openPreview(event.target.files)
              event.target.value = ''
            }} />
        </div>
      </header>

      <main className="workspace">
        {!desktop && <div className="workspace-heading">
          <h1>{copy.local}</h1>
          <span className="local-status"><span />{copy.offline}</span>
        </div>}
        {error && (
          <div className="error" role="alert">
            <AlertCircle size={18} /><span>{copy[error]}</span>
            <button type="button" aria-label={copy.close} onClick={() => editor.setError(null)}><X size={17} /></button>
          </div>
        )}
        <div className="editor-grid" data-tool={studioTab} data-source-tab={sourceTab || !project.clips.length}>
          {desktop && <>
            <nav className="studio-tools" aria-label={copy.studioMedia}>
              {([['media', copy.studioMedia, Film], ['subtitles', copy.studioSubtitles, ClosedCaption], ['audio', copy.studioAudio, Volume2],
                ['ai', copy.studioAI, CircleHelp], ['director', language === 'tr' ? 'Yönetmen' : 'Director', Film],
                ['effects', copy.studioEffects, MonitorPlay], ['cover', language === 'tr' ? 'Kapak' : 'Cover', Film],
                ['performance', language === 'tr' ? 'Performans' : 'Performance', HardDrive],
                ['copilot', 'AI Copilot', CircleHelp], ['creator', language === 'tr' ? 'Yayın' : 'Publishing', Film],
                ['settings', language === 'tr' ? 'Ayarlar' : 'Settings', SlidersHorizontal]] as const).map(([id, label, Icon]) =>
                <button key={id} aria-pressed={studioTab === id} onClick={() => { if (id !== 'ai' && id !== 'director') stopAutoPreview(); setStudioTab(id) }}><Icon size={15} />{label}</button>)}
            </nav>
            <div className="studio-split left"><StudioDivider name={copy.studioResize + ' · ' + copy.studioMedia} axis="width" value={layout.left} min={222} max={408} resize={left => changeLayout({ left })} /></div>
            <div className="studio-split right"><StudioDivider name={copy.studioResize + ' · ' + copy.studioInspector} axis="width" value={layout.right} min={215} max={375} resize={right => changeLayout({ right })} invert /></div>
            <div className="studio-split bottom"><StudioDivider name={copy.studioResize + ' · ' + copy.timeline} axis="height" value={layout.timeline} min={220} max={495} resize={timeline => changeLayout({ timeline })} invert /></div>
          </>}
          <section className="panel viewer" aria-labelledby="preview-heading" onDrop={handleDrop}
            onDragEnter={event => {
              if (!event.dataTransfer.types.includes('Files')) return
              event.preventDefault()
              dragDepth.current++
              setDragging(true)
            }}
            onDragOver={event => {
              if (!event.dataTransfer.types.includes('Files')) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1)
              if (!dragDepth.current) setDragging(false)
            }}>
            <header className="panel-header viewer-header">
              <h2 id="preview-heading"><MonitorPlay size={17} />{copy.preview}</h2>
              {usingProxy && <small>Proxy · {usingProxy.height}p</small>}
              {source && proxyFallback === source.url && <small role="status">{language === 'tr' ? 'Proxy bulunamadı. Özgün video açıldı.' : 'Proxy unavailable. Showing original video.'}</small>}
              <span className="media-label" title={source?.file.name}>{source?.file.name ?? copy.noSource}</span>
              {source && <button type="button" className="export-cancel" onClick={() => detachPreview()} aria-label={copy.clearSource} title={copy.clearSource}><X size={15} /></button>}
            </header>
            <div className="layer-monitor-host" ref={setMonitorHost} />
            <div className={'stage' + (dragging ? ' dragging' : '') + (frame ? ' framed-stage' : '')}>
              <div className={'video-frame' + (frame ? ' framed' : fitCaption ? ' caption-fit' : '')} style={previewStyle}>
              {source && (
                <video className="main-video" key={source.revision + ':' + videoUrl} ref={element} src={videoUrl} style={videoStyle} preload="metadata" playsInline muted={muted || !!selectedProjectClip?.muteAudio}
                  onLoadedMetadata={event => {
                    if (proxySeek.current?.url === source.url) {
                      const { seconds } = proxySeek.current
                      proxySeek.current = null
                      event.currentTarget.currentTime = Math.min(seconds, event.currentTarget.duration)
                    } else if (!usingProxy) editor.readMetadata(event.currentTarget)
                  }}
                  onTimeUpdate={event => editor.setTime(event.currentTarget.currentTime)}
                  onPlay={() => editor.setPlaying(true)}
                  onPause={() => { editor.setPlaying(false); candidateEnd.current = null }}
                  onEnded={event => { editor.setPlaying(false); advanceSequence(event.currentTarget, true) }}
                  onError={event => {
                    stopSequence()
                    if (usingProxy) { proxySeek.current = { url: source.url, seconds: time }; setProxyId(undefined); setProxyFallback(source.url) }
                    else editor.fail(event.currentTarget)
                  }} />
              )}
              {metadata && safeGuides && <div className="caption-safe-guide" aria-hidden="true" />}
              {metadata && (!previewCues.length ? !activeAuto && showSample && (appearance.motion !== undefined || appearance.safe ?
                <CaptionPreview cue={{ start: 0, end: 2, text: copy.sample }} appearance={appearance} time={1} video={element} playing={false} />
                : <span className={'stage-caption subtitle ' + style}>{copy.sample}</span>)
                : activeCues.slice(-1).map(cue => <CaptionPreview key={cue.start} cue={cue} appearance={activeAuto?.appearance ?? appearance} time={time} video={element} playing={playing} />))}
              </div>
              {!source && (
                <div className="empty-state">
                  <span className="empty-icon"><Upload size={25} strokeWidth={1.7} /></span>
                  <h3>{copy.emptyTitle}</h3>
                  <p>{copy.emptyHelp}</p>
                  <button type="button" className="choose" onClick={() => picker.current?.click()}>{copy.choose}</button>
                  <span className="formats">MP4 <i /> WEBM</span>
                </div>
              )}
              {source && !metadata && <span className="loading" role="status">{copy.loading}</span>}
            </div>
            <div className="transport">
              <div className="transport-time"><strong>{timecode(time)}</strong><span>/ {metadata ? timecode(metadata.duration) : '—'}</span></div>
              <div className="playback">
                <button type="button" disabled={!metadata} aria-label={copy.jumpStart} title={copy.jumpStart} onClick={() => editor.seek(range.start)}><SkipBack size={17} /></button>
                <button type="button" className="play-button" disabled={!metadata} aria-label={playing ? copy.pause : copy.play} title={playing ? copy.pause : copy.play}
                  onClick={() => { if (sequence.current) stopSequence(); else void editor.togglePlayback() }}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
                <button type="button" disabled={!metadata} aria-label={copy.jumpEnd} title={copy.jumpEnd} onClick={() => editor.seek(range.end)}><SkipForward size={17} /></button>
              </div>
              <button type="button" className="mute-button" disabled={!metadata} aria-label={muted ? copy.unmute : copy.mute}
                title={muted ? copy.unmute : copy.mute} onClick={() => editor.setMuted(!muted)}>
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            </div>
          </section>

          <div className="studio-timeline-source">
            {desktop && !!project.clips.length && <button className="studio-mode" onClick={() => setSourceTab(false)}>{copy.studioTracks}</button>}
            <Timeline editor={editor} copy={copy} cues={cues} silence={silenceMarkers} removals={edit.remove} />
          </div>
          <div className="studio-tool-content">
          {desktop && studioTab === 'hub' && <div ref={setHubHost} />}
          {desktop && workspace === 'ai' && <nav className="workspace-steps" aria-label={language === 'tr' ? 'AI araçları' : 'AI tools'}>
            {([['ai', copy.autoShorts], ['director', language === 'tr' ? 'Yönetmen' : 'Director'], ['subtitles', copy.studioSubtitles], ['copilot', 'Copilot']] as const)
              .map(([tool, label]) => <button key={tool} className="export-cancel" aria-pressed={studioTab === tool} onClick={() => { stopAutoPreview(); setStudioTab(tool) }}>{label}</button>)}
          </nav>}
          {desktop && studioTab === 'cover' && <section className="panel"><header className="panel-header"><h2>{language === 'tr' ? 'Kapak stüdyosu' : 'Cover studio'}</h2></header>
            {source && metadata ? <CoverStudio key={source.url} language={language} source={source.url} range={range} cues={cues} /> : <p>{copy.emptyHelp}</p>}
          </section>}
          {desktop && studioTab === 'effects' && <div className="panel effect-library-host" ref={setEffectHost} />}
          {desktop && (studioTab === 'effects' || studioTab === 'audio') && <EffectsPanel key={studioTab + (source?.url ?? '')}
            audio={studioTab === 'audio'} copy={copy} range={range} file={source?.file} cues={cues} effects={effects}
            edit={edit} update={updateEffects} undo={undoEffects} compare={compare} setCompare={setCompare} pause={stopSequence} />}
          {desktop && studioTab === 'audio' && <Suspense fallback={null}><AudioInspector key={mountedSource?.id ?? 'audio-empty'}
            id={mountedSource?.id} range={range} language={language} copy={copy} effects={effects} update={updateEffects} /></Suspense>}
          {desktop && <AutoShortsPanel key={autoMedia?.media.id ?? 'auto-empty'} copy={copy} language={language} media={autoMedia?.media}
            duration={autoMedia?.duration ?? 0} appearance={appearance} frame={edit.frame ?? project.frame}
            open={media => { void chooseAutoSource(media) }} preview={previewAutoClip} stopPreview={stopAutoPreview} apply={applyShorts} />}
          {desktop && <DirectorPanel copy={copy} language={language} source={autoMedia}
            open={media => { void chooseAutoSource(media) }} preview={previewAutoClip} load={loadProject} apply={applyShorts} />}
          {desktop && studioTab === 'performance' && <PerformanceCenter language={language} />}
          {desktop && studioTab === 'settings' && beta && <BetaSettings language={language} settings={beta} update={setBeta} version={version} />}
          {desktop && <CreatorPanel visible={studioTab === 'creator'} language={language} intent={creatorIntent}
            source={source && mountedSource && metadata ? { media: mountedSource, file: source.file, duration: metadata.duration } : undefined}
            choose={async () => {
              const result = await window.viralCutDesktop?.shorts.chooseSource(language)
              if (!result?.media) return false
              await chooseAutoSource(result.media)
              return true
            }} />}
          {desktop && <CopilotPanel visible={studioTab === 'copilot'} language={language} copy={copy} project={project} selected={currentClip} layerSelected={layerSelected}
            creator={intent => { setCreatorIntent(intent); setStudioTab('creator') }}
            keyId={copilotProject} source={source && mountedSource && metadata ? { media: mountedSource, file: source.file, duration: metadata.duration } : undefined}
            apply={(expected, next) => {
              if (next.clips.length) { stopAutoPreview(); stopSequence(); setSourceTab(false) }
              updateProject(current => current === expected ? next : current)
              if (next.clips.length && !next.clips.some(clip => clip.id === currentClip)) positionClip(next.clips[0], false, next.media)
            }}
            history={(tool, count) => {
              if ((tool === 'undo' ? history.previous : history.next).length < count) return false
              stopAutoPreview(); stopSequence()
              for (let i = 0; i < count; i++) dispatch({ type: tool })
              return true
            }}
            choose={async () => {
              const result = await window.viralCutDesktop?.shorts.chooseSource(language)
              if (!result?.media) return false
              await chooseAutoSource(result.media)
              return true
            }}
            select={(index, seconds) => {
              if (index >= 0) {
                const clip = project.clips[index]
                if (!clip || (seconds !== undefined && (seconds < clip.start || seconds > clip.end))) return false
                return positionClip(clip, false, project.media, seconds)
              }
              if (!metadata || seconds === undefined || seconds > metadata.duration) return false
              editor.seek(seconds)
              return true
            }}
            close={() => setStudioTab('media')} before={() => { stopAutoPreview(); setCompare(!compare) }} compare={compare}
            previewShort={(context, index) => {
              if (mountedSource?.id !== context.source) return
              const { item } = context.rows[index]
              previewAutoClip(item, item.overlay?.cues ?? [], item.overlay?.appearance ?? appearance, item.frame, item.remove, item.effects, mountedSource)
            }} />}
          {desktop && <section className="panel studio-library"><header className="panel-header"><h2>{copy.studioMedia}</h2></header>
            <div className="studio-library-body">
              {source && !mountedSource && <p>{source.file.name}</p>}
              {!source && !project.media.length && <p>{copy.emptyHelp}</p>}
              {!!project.media.length && <MediaLibrary project={project} selected={projectMedia?.id} tr={language === 'tr'}
                open={media => {
                  const clip = project.clips.find(item => item.mediaId === media.id)
                  stopSequence(); stopAutoPreview()
                  if (clip) positionClip(clip, false)
                  else { pending.current = null; setProxyId(undefined); editor.openLinked(media) }
                }} remove={id => updateProject(value => value.clips.some(clip => clip.mediaId === id) ||
                  value.timeline?.tracks.some(track => track.clips.some(clip => clip.mediaId === id)) ? value
                  : { ...value, media: value.media.filter(item => item.id !== id) })} />}
              <MediaPreparation key={projectMedia?.id ?? 'none'} media={projectMedia} copy={copy} proxy={usingProxy?.height}
                selectProxy={selectProxy} setWaveform={storeWaveform} kind="proxy" tr={language === 'tr'} />
            </div></section>}
          <ShortsPanel key={'shorts:' + (source?.url ?? '')} editor={editor} copy={copy} cues={cues} edit={edit}
            clearRemoval={() => setShorts(current => current.file === source?.file && current.edit
              ? { ...current, edit: { ...current.edit, remove: [] } } : current)}
            changeEdit={value => setShorts(current => ({ ...(current.file === source?.file ? current : {}), file: source?.file, edit: value }))}
            setMarkers={markers => setShorts(current => ({ ...(current.file === source?.file ? current : {}), file: source?.file, markers }))}
            preview={afterPreview} setPreview={preview => setShorts(current => ({ ...(current.file === source?.file ? current : {}), file: source?.file, preview }))}
            playCandidate={playCandidate} applyCandidate={useCandidate} />
          <SubtitlePanel key={'captions:' + (source?.url ?? '')} editor={editor} copy={copy} cues={cues}
            setCues={next => {
              if (projectMedia) updateProject(value => ({ ...value, media: value.media.map(item => item.id === projectMedia.id ? { ...item, cues: next } : item) }))
              else setCaptionTrack({ file: source?.file, cues: next })
            }} appearance={appearance} setAppearance={setAppearance} language={language} />
          {desktop && <div className="studio-speech" ref={setSpeechHost} />}
          {desktop && studioTab === 'audio' && <MediaPreparation key={projectMedia?.id ?? 'none'} media={projectMedia} copy={copy}
            selectProxy={selectProxy} setWaveform={storeWaveform} kind="waveform" tr={language === 'tr'} />}
          </div>

          <aside className="inspector">
            {desktop && <Diagnostics language={language} copy={copy} />}
            <section className="panel" aria-labelledby="info-heading">
              <header className="panel-header"><h2 id="info-heading"><Film size={17} />{copy.videoInfo}</h2></header>
              <dl className="metadata">
                <div><dt>{copy.source}</dt><dd title={source?.file.name}>{source?.file.name ?? '—'}</dd></div>
                <div><dt>{copy.duration}</dt><dd>{metadata ? timecode(metadata.duration) : '—'}</dd></div>
                <div><dt>{copy.resolution}</dt><dd>{metadata ? metadata.width + ' × ' + metadata.height : '—'}</dd></div>
                <div><dt>{copy.size}</dt><dd>{source ? sizeLabel(mountedSource?.size ?? source.file.size, language) : '—'}</dd></div>
              </dl>
            </section>

            <section className="panel studio-caption-styles" aria-labelledby="captions-heading">
              <header className="panel-header"><h2 id="captions-heading"><ClosedCaption size={18} />{copy.captions}</h2></header>
              <div className="captions">
                <div className="caption-options" role="group" aria-label={copy.captions}>
                  {subtitleStyles.map(option => (
                    <button type="button" key={option} aria-pressed={style === option} onClick={() => setStyle(option)}>
                      <span className={'subtitle ' + option} aria-hidden="true">Aa</span>
                      <span>{copy[option]}</span>
                    </button>
                  ))}
                </div>
                <div className="caption-sample" aria-live="polite"><span className={'subtitle ' + style}>{copy.sample}</span></div>
                <p><CircleHelp size={13} />{copy.sampleHelp}</p>
                <label className="caption-toggle">
                  <span>{copy.showCaptions}</span>
                  <input type="checkbox" checked={showSample} onChange={event => setShowSample(event.target.checked)} />
                </label>
              </div>
            </section>
            {desktop && <div ref={setSettingsHost} />}
            {metadata && <label className="caption-guide-toggle"><input type="checkbox" checked={safeGuides} onChange={event => setSafeGuides(event.target.checked)} />{language === 'tr' ? 'Altyazı güvenli alanı' : 'Caption safe area'}</label>}
            {desktop && <div className="studio-single-export">{singleExport}</div>}
          </aside>
          {!desktop && singleExport}
          <ProjectPanel libraryHost={effectHost} selectLayer={setLayerSelected} project={project} copy={copy} media={projectMedia} current={currentClip} setCurrent={setCurrentClip}
            hubHost={hubHost} flushLayout={flushLayout} openTool={tool => { if (tool === 'ai') switchWorkspace('ai'); else setStudioTab('subtitles') }}
            legacyView={legacyView} switchEditView={layered => switchWorkspace(layered ? 'professional' : 'easy')}
            autosaveInterval={beta?.interval ?? 5} language={language} projectEpoch={copilotProject}
            undo={!!history.previous.length} redo={!!history.next.length} history={type => { stopSequence(); dispatch({ type }) }}
            update={updateProject} load={loadProject} addMedia={entries => { void addProjectMedia(entries) }}
            playhead={time} playback={sequencePlaying} stop={stopSequence} play={playSequence}
            select={clip => { stopSequence(); positionClip(clip, false) }}
            duration={metadata?.duration ?? 0} range={range} setProfile={profile => updateProject(value => ({ ...value, profile }))}
            framing={edit.frame} removals={edit.remove} monitorHost={monitorHost} settingsHost={settingsHost} speechHost={speechHost} waveforms={waveforms}
            openSource={() => setSourceTab(true)} selectSpeech={useCandidate} seekProject={(clip, seconds) => {
              stopSequence(); positionClip(clip, false, project.media, seconds)
            }} />
        </div>

        {!desktop && <footer className="workspace-footer"><span><HardDrive size={14} />ViralCut AI Desktop</span><span>v{version.replace(/-beta$/, ' Beta')}</span></footer>}
      </main>
    </div>
  )
}
