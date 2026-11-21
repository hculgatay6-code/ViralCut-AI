import { useEffect, useRef, useState } from 'react'
import { Play, Sparkles } from 'lucide-react'
import { ExportClientError, localExporter } from '../export/client'
import type { BatchRequest, BatchResult, ShortsAnalysis } from '../export/client'
import type { Copy, Language } from '../i18n'
import type { ProjectMedia } from '../project/model'
import type { Appearance, Cue } from '../subtitles/model'
import { stylePresets } from '../subtitles/model'
import { CaptionStudio } from '../subtitles/CaptionStudio'
import { CoverStudio } from './CoverStudio'
import { editedDuration, pauseSettings, recommendShorts, safePauses } from './autoShorts'
import type { Candidate } from './autoShorts'
import { timecode } from './model'
import type { ClipRange } from './model'
import { defaultFrame, sizes } from './shorts'
import type { Frame } from './shorts'
import { suggestZoom } from './effects'
import type { StudioEffects } from './effects'
import { speechCutInside } from './approved-shorts'
import type { ApprovedShorts } from './approved-shorts'

type Props = {
  copy: Copy; language: Language; media?: ProjectMedia; duration: number; appearance: Appearance; frame?: Frame
  open: (media: ProjectMedia) => void
  preview: (range: ClipRange, cues: Cue[], appearance: Appearance, frame: Frame, remove: ClipRange[], effects?: StudioEffects) => void
  stopPreview: () => void
  apply: (media: ProjectMedia, plan: ApprovedShorts) => boolean
  applyProfessional: (media: ProjectMedia, plan: ApprovedShorts, hasAudio: boolean) => boolean
}

const wait = () => new Promise<void>(resolve => setTimeout(resolve, 350))

export function AutoShortsPanel({ copy, language, media, duration, appearance, frame, open, preview, stopPreview, apply, applyProfessional }: Props) {
  const tr = language === 'tr'
  const bridge = window.viralCutDesktop?.shorts
  const [speechLanguage, setSpeechLanguage] = useState<'auto' | 'tr' | 'en'>('auto')
  const [goal, setGoal] = useState(30)
  const [showAll, setShowAll] = useState(false)
  const [analysis, setAnalysis] = useState<ShortsAnalysis>()
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [automatic, setAutomatic] = useState(true)
  const [settings, setSettings] = useState(pauseSettings)
  const [showCaptions, setShowCaptions] = useState(true)
  const [smartZoom, setSmartZoom] = useState(false)
  const [enhance, setEnhance] = useState(false)
  const [edgeFade, setEdgeFade] = useState(false)
  const [highlight, setHighlight] = useState(true)
  const [style, setStyle] = useState<Appearance['style']>(appearance.style)
  const [design, setDesign] = useState<Appearance>()
  const [cover, setCover] = useState<number>()
  const [outputFrame, setFrame] = useState<Frame>({ ...(frame ?? defaultFrame), mode: 'vertical', track: undefined })
  const [resolution, setResolution] = useState<720 | 1080>(1080)
  const [encoder, setEncoder] = useState<'auto' | 'cpu'>('auto')
  const [progress, setProgress] = useState<number>()
  const [stage, setStage] = useState<'silence' | 'speech' | 'media' | 'ranking' | 'vision'>('silence')
  const [visualMode, setVisualMode] = useState<'general' | 'gaming'>('general')
  const [visualDevice, setVisualDevice] = useState<'auto' | 'cpu'>('auto')
  const [track, setTrack] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [batch, setBatch] = useState<BatchResult>()
  const [folder, setFolder] = useState('')
  const [dialog, setDialog] = useState(false)
  const [cueEdit, setCueEdit] = useState<number>()
  const [skippedPauses, setSkippedPauses] = useState<Record<string, boolean>>({})
  const [pauseEdit, setPauseEdit] = useState<number>()
  const [checkedItems, setCheckedItems] = useState<number[]>([])
  const operation = useRef<{ controller: AbortController; id?: string }>(null)
  const lastBatch = useRef<{ request: BatchRequest; numbers: number[] }>(null)
  const busy = dialog || progress !== undefined || !!batch?.active

  useEffect(() => {
    function cancel() {
      const active = operation.current
      active?.controller.abort()
      if (active?.id) void localExporter.release(active.id)
    }
    window.addEventListener('pagehide', cancel)
    return () => { window.removeEventListener('pagehide', cancel); cancel() }
  }, [])

  useEffect(() => {
    if (!bridge || !batch?.active) return
    let disposed = false
    const timer = window.setInterval(() => {
      void bridge.status().then(result => { if (!disposed) setBatch(result) }).catch(() => {
        if (!disposed) { setError(copy.exportErrors.serviceError); setBatch(undefined) }
      })
    }, 350)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [bridge, batch?.active, copy])

  if (!bridge) return null

  async function choose() {
    if (!bridge || busy) return
    setDialog(true); setError(''); setNotice('')
    try {
      const result = await bridge.chooseSource(language)
      if (result.media) open(result.media)
      if (result.error) setError(copy.decode)
    } catch { setError(copy.decode) } finally { setDialog(false) }
  }

  async function analyze() {
    if (!media || !duration || operation.current || busy || !Number.isInteger(goal) || goal < 15 || goal > 60) return
    const job: { controller: AbortController; id?: string } = { controller: new AbortController() }
    const signal = job.controller.signal
    operation.current = job
    stopPreview(); setStage('silence'); setProgress(0); setError(''); setNotice('')
    try {
      job.id = (await localExporter.analyzeShorts(media.id, speechLanguage, settings.threshold, settings.minimum, goal, duration, visualMode, visualDevice)).id
      while (!signal.aborted) {
        const update = await localExporter.status(job.id, signal)
        setProgress(update.progress)
        if (update.stage) setStage(update.stage)
        if (update.phase === 'failed') throw new ExportClientError(update.error ?? 'transcriptFailed')
        if (update.phase === 'ready') {
          const result = await localExporter.shortsAnalysis(job.id, signal)
          signal.throwIfAborted()
          setSkippedPauses({}); setPauseEdit(undefined); setCueEdit(undefined); setCover(undefined)
          setAnalysis(result)
          setShowAll(false)
          setCandidates(result.selection?.candidates ?? recommendShorts(result.cues, result.silences, duration, automatic ? settings.padding : null))
          break
        }
        await wait()
      }
    } catch (reason) {
      if (!signal.aborted) setError(copy.exportErrors[reason instanceof ExportClientError ? reason.code : 'serviceError'])
    } finally {
      if (job.id) await localExporter.release(job.id)
      setProgress(undefined)
      if (signal.aborted) setNotice(copy.exportCancelled)
      operation.current = null
    }
  }

  const baseCaption = design ?? appearance
  const captions: Appearance = { ...baseCaption, ...(style === baseCaption.style ? {} : stylePresets[style]), style, highlight }
  const cues = (range: ClipRange) => (analysis?.cues ?? []).filter(cue => cue.text.trim() && cue.start < range.end && cue.end > range.start)
  const detectedPauses = (range: ClipRange) => automatic ? safePauses(range, analysis?.silences ?? [], analysis?.cues ?? [], settings.padding) : []
  const pauseKey = (item: Candidate, span: ClipRange) => [item.id, span.start, span.end].join(':')
  const pauses = (item: Candidate) => {
    const limit = Math.max(0, item.end - item.start - 15)
    let removed = 0
    return detectedPauses(item).filter(span => {
      if (skippedPauses[pauseKey(item, span)] || removed + span.end - span.start > limit) return false
      removed += span.end - span.start
      return true
    })
  }
  const valid = (item: Candidate) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= 0 && item.end <= duration + .001 &&
    item.end - item.start <= 60.001 && editedDuration(item, pauses(item)) >= 14.999
  const framing = (item: Candidate): Frame => outputFrame.mode === 'vertical' && track && item.track?.length
    ? { ...outputFrame, track: item.track } : outputFrame
  const enhancements = (rows: Cue[], item: Candidate): StudioEffects | undefined => smartZoom || enhance || edgeFade ? {
    zoom: smartZoom ? suggestZoom(rows, item) : undefined,
    ...(enhance ? { voice: true, noise: 7, normalize: true } : {}),
    ...(edgeFade ? { fadeIn: .25, fadeOut: .25 } : {}),
  } : undefined
  const targetSize = sizes[outputFrame.mode].map(side => Math.round(side * resolution / 1080)).join(' × ')

  async function startBatch(request: BatchRequest, numbers: number[]) {
    if (!bridge || busy) return
    setError(''); setNotice(''); setDialog(true)
    try {
      const result = await bridge.start(request)
      if (result.cancelled) return
      if (result.error) { setError(copy.exportErrors[result.error] ?? copy.exportErrors.serviceError); return }
      lastBatch.current = { request, numbers }
      setCheckedItems(numbers); setFolder(result.folder ?? ''); setBatch(result)
    } catch { setError(copy.exportErrors.serviceError) } finally { setDialog(false) }
  }

  async function exportClips(single?: number, destination?: 'easy' | 'professional') {
    const items = candidates.map((item, index) => ({ item, index })).filter(({ item, index }) => single === undefined ? item.selected : index === single)
    if (!bridge || !media || busy || !items.length) return
    if (items.some(({ item }) => !valid(item))) { setError(copy.autoInvalid); return }
    setError(''); setNotice('')
    const request: BatchRequest = { mediaId: media.id, language, resolution, encoder,
      items: items.map(({ item }) => {
        const rows = cues(item)
        return { start: item.start, end: item.end, frame: framing(item), remove: pauses(item), edgeFade,
          effects: enhancements(rows, item),
          overlay: showCaptions && rows.length ? { appearance: captions, cues: rows } : undefined }
      }) }
    if (destination) {
      const applied = destination === 'easy' ? apply(media, request) : applyProfessional(media, request, analysis?.hasAudio !== false)
      if (!applied) setError(destination === 'easy' ? copy.autoInvalid :
        tr ? 'Plan zaman çizelgesine sığmıyor veya kaynak aralığı geçersiz. Daha az klip seçip yeniden dene.' :
          'The plan exceeds timeline limits or contains an invalid range. Select fewer clips and retry.')
      return
    }
    await startBatch(request, items.map(({ index }) => index + 1))
  }

  function updateClip(index: number, patch: Partial<Candidate>) {
    setCandidates(items => items.map((item, i) => i === index ? { ...item, ...patch,
      evaluation: patch.start === undefined && patch.end === undefined ? item.evaluation : undefined,
      visual: patch.start === undefined && patch.end === undefined ? item.visual : undefined,
      track: patch.start === undefined && patch.end === undefined ? item.track : undefined } : item))
  }

  function manualClip() {
    if (duration < 15 || candidates.length >= 5) return
    setShowAll(true)
    setCandidates(items => [...items, { id: -(items.length + 1), start: 0, end: Math.min(goal, duration),
      boundaries: 0, speech: 0, text: '', selected: true }])
  }

  return <section className="panel auto-shorts" aria-label={copy.autoShorts}>
    <header className="panel-header"><h2><Sparkles size={16} />{copy.autoShorts}</h2></header>
    <div className="auto-shorts-body">
      <h3 className="semantic-heading">{copy.semanticHeading}</h3>
      <div className="shorts-actions">
        <button type="button" className="export-cancel" disabled={busy} onClick={() => void choose()}>{copy.autoChoose}</button>
        <button type="button" className="primary" disabled={busy || !media || !duration || !Number.isInteger(goal) || goal < 15 || goal > 60} onClick={() => void analyze()}>{tr ? 'AI ile Videomu Düzenle' : 'Edit my video with AI'}</button>
      </div>
      {media && <p title={media.name}>{media.name} · {timecode(duration)}</p>}
      <div className="auto-settings">
        <label>{copy.visual.mode}<select value={visualMode} disabled={busy} onChange={event => setVisualMode(event.target.value as typeof visualMode)}>
          <option value="general">{copy.visual.general}</option><option value="gaming">{copy.visual.gaming}</option></select></label>
        <label>{copy.visual.processor}<select value={visualDevice} disabled={busy} onChange={event => setVisualDevice(event.target.value as typeof visualDevice)}>
          <option value="auto">{copy.autoDetect}</option><option value="cpu">CPU</option></select></label>
        <label>{copy.autoLanguage}<select disabled={busy} value={speechLanguage} onChange={event => setSpeechLanguage(event.target.value as typeof speechLanguage)}>
          <option value="auto">{copy.autoDetect}</option><option value="tr">Türkçe</option><option value="en">English</option></select></label>
        <label>{copy.semanticGoal}<input type="number" min={15} max={60} step={1} disabled={busy} value={goal || ''}
          onChange={event => setGoal(Number(event.target.value))} /></label>
        <div className="shorts-actions">{[15, 30, 60].map(value => <button key={value} type="button" disabled={busy}
          aria-pressed={goal === value} onClick={() => setGoal(value)}>{value} {copy.seconds}</button>)}</div>
      </div>
      {progress !== undefined && <div className="export-progress" role="status">
        <span>{copy.analysisStages[stage]} · {Math.floor(progress)}%</span><progress max={100} value={progress} aria-label={copy.autoAnalyze} />
        <button className="export-cancel" onClick={() => { operation.current?.controller.abort() }}>{copy.exportCancel}</button>
      </div>}
      {analysis && <>
        <p>{analysis.languages.join(' / ')} {analysis.backend && '· ' + analysis.backend} · {analysis.silences.length} {copy.autoPauses}</p>
        {!!analysis.width && !!analysis.height && <p>{tr ? 'Kaynak' : 'Source'} {analysis.width} × {analysis.height} · {copy.resolution} {targetSize}</p>}
        {analysis.hasAudio === false && <p role="status">{copy.visual.silent}</p>}
        {analysis.speechUnavailable && <p role="status">{copy.visual.speechUnavailable}</p>}
        {analysis.selection && <p role="status">{analysis.selection.mode === 'e5' ? copy.semanticModel : analysis.selection.mode === 'visual' ? copy.visual.visualOnly : copy.semanticFallback}
          {analysis.selection.reason && ' · ' + copy[analysis.selection.reason]}</p>}
        {analysis.visual && <details className="semantic-details"><summary>{copy.visual.heading} · {analysis.visual.events.length}</summary>
          <p>SSD MobileNet · {copy.visualStatus[analysis.visual.models[0] as keyof Copy['visualStatus']] ?? '—'} / Ultra-Light · {copy.visualStatus[analysis.visual.models[1] as keyof Copy['visualStatus']] ?? '—'}</p>
          <p>{copy.visual.gameNote}</p>
          <ol className="clip-candidates">{analysis.visual.events.map(event => <li key={event.time}>
            <button className="export-cancel" disabled={busy} onClick={() => {
              const start = Math.max(0, event.time - 1)
              preview({ start, end: Math.min(duration, start + 4) }, cues({ start, end: start + 4 }), captions, outputFrame, [])
            }}>{timecode(event.time)} · {event.cut ? copy.visual.cut : copy.visual.burst} · {event.motion}%</button>
          </li>)}</ol>
        </details>}
        {!!candidates.length && <p>{copy.semanticDisclaimer}</p>}
        {analysis.truncated && <p>{copy.limitReached}</p>}
        {!candidates.length && <p role="status">{copy.autoNoCandidates}</p>}
        {candidates.slice(0, showAll ? 5 : 3).map((item, index) => {
          const length = editedDuration(item, pauses(item))
          const rows = cues(item)
          const quiet = detectedPauses(item)
          return <article className="auto-card" key={item.id + ':' + index}>
            <div className="auto-card-head"><label><input type="checkbox" checked={item.selected} disabled={busy}
              onChange={event => updateClip(index, { selected: event.target.checked })} />{copy.autoClip} {index + 1}</label>
              <span>{timecode(Math.max(0, length), false)}</span></div>
            {item.evaluation && <details className="semantic-details"><summary>{copy.semanticScore} <b>{item.evaluation.score}/100</b></summary>
              <dl>{Object.entries(item.evaluation.metrics).map(([key, value]) => <div key={key}>
                <dt>{copy.semanticMetrics[key as keyof Copy['semanticMetrics']]}</dt><dd>{value === null ? '—' : value + '%'}</dd></div>)}</dl>
              <p>{item.evaluation.reasons.map(key => copy.semanticReasons[key]).join(' · ')}</p></details>}
            {speechCutInside(item, analysis.cues) && <p role="status">{language === 'tr'
              ? 'Bir kesim konuşma aralığının içinde.' : 'A cut falls inside detected speech.'}</p>}
            {!!item.visual?.objects.length && <p>{copy.visual.detected} · {item.visual.objects.join(', ')}</p>}
            {!!rows.length && <details className="semantic-details"><summary>{copy.semanticTranscript}</summary>
              <p>{rows.map(row => row.text.trim()).join(' ')}</p></details>}
            {!!item.boundaries && <p>{item.boundaries === 6 ? copy.autoSentence : copy.autoBoundary} · {Math.round(item.speech * 100)}% {copy.autoSpeech}</p>}
            <div className="auto-settings">{(['start', 'end'] as const).map(key => <label key={key}>{copy[key]}
              <input type="number" min={0} max={duration} step=".01" disabled={busy} value={Number(item[key].toFixed(3))}
                aria-label={copy[key] + ' · ' + copy.autoClip + ' ' + (index + 1)}
                onChange={event => { if (event.target.value !== '') updateClip(index, { [key]: Number(event.target.value) }) }} /></label>)}</div>
            <div className="shorts-actions">
              <button className="export-cancel" disabled={busy || !valid(item)} onClick={() => preview(item, showCaptions ? rows : [], captions, framing(item), pauses(item),
                enhancements(rows, item))}>
                <Play size={12} /> {copy.preview}</button>
              {!!rows.length && <button className="export-cancel" disabled={busy} onClick={() => setCueEdit(cueEdit === index ? undefined : index)}>{copy.autoEditCaptions}</button>}
              {!!quiet.length && <button className="export-cancel" disabled={busy} onClick={() => setPauseEdit(pauseEdit === index ? undefined : index)}>{copy.silenceHeading} · {pauses(item).length}</button>}
              <button className="export-cancel" disabled={busy || !valid(item)} onClick={() => { stopPreview(); setCover(cover === index ? undefined : index) }}>{language === 'tr' ? 'Kapak hazırla' : 'Make cover'}</button>
              <button className="export-cancel" disabled={busy || !valid(item)} onClick={() => void exportClips(index)}>{copy.semanticExportOne}</button>
            </div>
            {!valid(item) && <p role="status">{copy.autoInvalid}</p>}
            {cover === index && media && valid(item) && <CoverStudio key={`${item.start}:${item.end}`} language={language}
              source={'/project-media/' + media.id} range={item} cues={rows} />}
            {pauseEdit === index && <div className="auto-cues">{quiet.map(span => <label key={pauseKey(item, span)} className="auto-pause">
              <input type="checkbox" disabled={busy} checked={!skippedPauses[pauseKey(item, span)]} onChange={event => {
                setSkippedPauses({ ...skippedPauses, [pauseKey(item, span)]: !event.target.checked })
              }} />{timecode(span.start)} – {timecode(span.end)}</label>)}</div>}
            {cueEdit === index && <div className="auto-cues">{analysis.cues.map((cue, offset) => cue.start < item.end && cue.end > item.start && <div key={offset}>
              <div className="auto-settings">{(['start', 'end'] as const).map(key => <label key={key}>{copy[key]}
                <input type="number" min="0" max={duration} step=".01" defaultValue={cue[key]} key={cue[key]} disabled={busy}
                  onBlur={event => {
                    const value = Number(event.target.value)
                    const next = { ...cue, [key]: value, words: undefined }
                    if (!event.target.value || !Number.isFinite(value) || next.start < 0 || next.end > duration || next.end - next.start < .01) {
                      event.target.value = String(cue[key]); return
                    }
                    if (value !== cue[key]) setAnalysis({ ...analysis, cues: analysis.cues.map((row, i) => i === offset ? next : row) })
                  }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>)}</div>
              <textarea aria-label={copy.autoEditCaptions + ' ' + (offset + 1)} value={cue.text}
                disabled={busy} maxLength={500} onChange={event => {
                  const text = event.target.value
                  setAnalysis({ ...analysis, cues: analysis.cues.map((row, i) => i === offset ? { ...row, text, words: undefined } : row) })
                }} /></div>)}</div>}
          </article>
        })}
        {candidates.length > 3 && <button className="export-cancel" onClick={() => setShowAll(!showAll)}>{showAll ? copy.semanticTop : copy.semanticMore}</button>}
        {candidates.length > 1 && <details className="semantic-details"><summary>{copy.semanticCompare}</summary>
          <table><thead><tr><th>{copy.autoClip}</th><th>{copy.duration}</th><th>{copy.semanticScore}</th></tr></thead>
            <tbody>{candidates.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td>{timecode(editedDuration(item, pauses(item)), false)}</td>
              <td>{item.evaluation?.score ?? '—'}</td></tr>)}</tbody></table></details>}
        <button className="export-cancel" disabled={busy || duration < 15 || candidates.length >= 5} onClick={manualClip}>{copy.autoManual}</button>
      </>}
      <CaptionStudio language={language} appearance={captions} disabled={busy || !showCaptions} apply={value => {
        setDesign(value); setStyle(value.style); setHighlight(value.highlight)
      }} />
      <details className="auto-tuning">
        <summary>{copy.studioInspector}</summary>
        <div className="auto-settings">
          <label><input type="checkbox" checked={track} disabled={busy} onChange={event => setTrack(event.target.checked)} />{copy.visual.track}</label>
          <label><input type="checkbox" checked={smartZoom} disabled={busy} onChange={event => setSmartZoom(event.target.checked)} />{copy.fxSmart}</label>
          <label><input type="checkbox" checked={enhance} disabled={busy} onChange={event => setEnhance(event.target.checked)} />{copy.fxAudioApply}</label>
          <label><input type="checkbox" checked={edgeFade} disabled={busy} onChange={event => setEdgeFade(event.target.checked)} />{copy.fxEdge}</label>
          <label>{copy.resolution}<select disabled={busy} value={resolution} onChange={event => setResolution(Number(event.target.value) as typeof resolution)}>
            <option value={1080}>1080p</option><option value={720}>720p</option></select></label>
          <label>{tr ? 'Çıktı oranı' : 'Output aspect ratio'}<select disabled={busy} value={outputFrame.mode}
            onChange={event => setFrame({ ...outputFrame, track: undefined, mode: event.target.value as Frame['mode'] })}>
            <option value="vertical">9:16</option><option value="square">1:1</option><option value="landscape">16:9</option></select></label>
          <label>{copy.encodingMode}<select disabled={busy} value={encoder} onChange={event => setEncoder(event.target.value as typeof encoder)}>
            <option value="auto">{copy.encodingAuto}</option><option value="cpu">CPU</option></select></label>
          <label><input type="checkbox" checked={automatic} disabled={busy} onChange={event => setAutomatic(event.target.checked)} />{copy.silenceHeading}</label>
          <label>{copy.silenceThreshold}<input type="number" min={-65} max={-12} disabled={busy} value={settings.threshold}
            onChange={event => setSettings({ ...settings, threshold: Number(event.target.value) })} /></label>
          <label>{copy.silenceMinimum}<input type="number" min={.2} max={10} step=".05" disabled={busy} value={settings.minimum}
            onChange={event => setSettings({ ...settings, minimum: Number(event.target.value) })} /></label>
          <label>{copy.silencePadding}<input type="number" min={0} max={1} step=".05" disabled={busy} value={settings.padding}
            onChange={event => setSettings({ ...settings, padding: Math.max(0, Math.min(1, Number(event.target.value))) })} /></label>
          <label><input type="checkbox" checked={showCaptions} disabled={busy} onChange={event => setShowCaptions(event.target.checked)} />{copy.burnSubtitles}</label>
          <label><input type="checkbox" checked={highlight} disabled={busy || !showCaptions} onChange={event => setHighlight(event.target.checked)} />{copy.autoHighlight}</label>
          <label>{copy.captions}<select disabled={busy || !showCaptions} value={style} onChange={event => setStyle(event.target.value as typeof style)}>
            {(['classic', 'bold', 'box'] as const).map(value => <option key={value} value={value}>{copy[value]}</option>)}</select></label>
          {(['zoom', 'x', 'y'] as const).map(key => <label key={key}>{copy[key]}<input type="range" min={key === 'zoom' ? 1 : -1}
            max={key === 'zoom' ? 3 : 1} step=".01" value={outputFrame[key]} disabled={busy}
            onChange={event => { setTrack(false); setFrame({ ...outputFrame, [key]: Number(event.target.value) }) }} /></label>)}
        </div>
        <p>{copy.autoApplied}</p>
        {highlight && showCaptions && <p>{copy.autoWordFallback}</p>}
      </details>
      {!!candidates.length && <button className="primary" disabled={busy || !candidates.some(item => item.selected)} onClick={() => void exportClips()}>{copy.autoExport}</button>}
      {!!candidates.length && <button className="export-cancel" disabled={busy || !candidates.some(item => item.selected)}
        onClick={() => void exportClips(undefined, 'easy')}>{tr ? 'Seçilenleri Kolay Editöre ekle' : 'Add selected to Easy Editor'}</button>}
      {!!candidates.length && <div className="shorts-actions">
        <p>{tr ? 'Onaylanan kesimler ayrı video, ses ve altyazı kanalları olarak eklenir. Açık bir kurgu varsa projenin oranı ve altyazı ayarları kullanılır.' :
          'Approval adds separate video, audio and caption tracks. An existing edit uses its current aspect ratio and caption settings.'}</p>
        <button className="primary" disabled={busy || !candidates.some(item => item.selected)}
          onClick={() => void exportClips(undefined, 'professional')}>{tr ? 'Planı onayla ve zaman çizelgesine ekle' : 'Approve plan and add to timeline'}</button>
      </div>}
      {batch?.active && <button className="export-cancel" onClick={() => { void bridge.cancel().catch(() => setError(copy.exportErrors.serviceError)) }}>{copy.exportCancel}</button>}
      {batch && <div className="auto-batch" aria-label={copy.autoExport}>
        {folder && <p title={folder}>{folder}</p>}
        {batch.items.map((item, index) => <div key={index} className="auto-card" data-phase={item.phase}>
          <strong>{copy.autoClip} {checkedItems[index]} · {{ queued: copy.previewQueued, cancelled: copy.exportCancelled,
            ready: copy.exportSaved, failed: copy.autoFailed, processing: copy.exportProcessing }[item.phase]}</strong>
          {item.phase === 'processing' && <progress max={100} value={item.progress} />}
          {item.warnings?.map(warning => <p key={warning} role="status">{copy.qualityWarnings[warning]}</p>)}
          {item.filename && <p>{item.filename} · {item.encoder}</p>}
          {item.error && <p role="alert">{copy.exportErrors[item.error] ?? copy.exportErrors.serviceError}</p>}
        </div>)}
        {!batch.active && batch.items.some(item => item.phase === 'failed' || item.phase === 'cancelled') &&
          <button className="export-cancel" disabled={busy} onClick={() => {
            const previous = lastBatch.current
            if (!previous) return
            const pending = batch.items.flatMap((item, index) => item.phase === 'failed' || item.phase === 'cancelled' ? [index] : [])
            void startBatch({ ...previous.request, items: pending.map(index => previous.request.items[index]) },
              pending.map(index => previous.numbers[index]))
          }}>{tr ? 'Tamamlanmayan çıktıları yeniden dene' : 'Retry unfinished outputs'}</button>}
      </div>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </section>
}
