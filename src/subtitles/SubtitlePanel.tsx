import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Download, Plus, Trash2 } from 'lucide-react'
import { ExportClientError, localExporter } from '../export/client'
import type { ExportErrorCode } from '../export/client'
import type { Copy, Language } from '../i18n'
import { CaptionStudio } from './CaptionStudio'
import type { VideoEditor } from '../editor/useVideo'
import { timecode } from '../editor/model'
import { subtitleFile, updateStyle } from './files'
import type { Appearance, Cue, Transcript } from './model'

type Operation = { controller: AbortController; id?: string }

interface Props {
  editor: VideoEditor
  copy: Copy
  language: Language
  cues: Cue[]
  setCues: (cues: Cue[]) => void
  appearance: Appearance
  setAppearance: (appearance: Appearance) => void
}

function saveText(cues: Cue[], format: 'srt' | 'vtt', base: string) {
  const blob = new Blob([subtitleFile(cues, format)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = base + '.' + format
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function SubtitlePanel({ editor, copy, language: uiLanguage, cues, setCues, appearance, setAppearance }: Props) {
  const [tools, setTools] = useState<Awaited<ReturnType<typeof localExporter.whisper>> | null>()
  const [language, setLanguage] = useState<'auto' | 'tr' | 'en'>('auto')
  const [device, setDevice] = useState<'auto' | 'cpu'>('auto')
  const [phase, setPhase] = useState<'idle' | 'transfer' | 'recognition' | 'cancelling'>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<Pick<Transcript, 'backend' | 'languages'>>()
  const [error, setError] = useState<ExportErrorCode>()
  const [notice, setNotice] = useState('')
  const [modelIssue, setModelIssue] = useState(false)
  const [selectingModel, setSelectingModel] = useState(false)
  const [page, setPage] = useState(0)
  const active = useRef<Operation | null>(null)
  const duration = editor.metadata?.duration ?? 0
  const file = editor.source?.file
  const busy = phase !== 'idle'
  const pageSize = 30
  const totalPages = Math.max(1, Math.ceil(cues.length / pageSize))
  const currentPage = Math.min(page, totalPages - 1)
  const wordCount = useMemo(() => cues.filter(cue => cue.words?.length).length, [cues])

  useEffect(() => {
    const availability = new AbortController()
    localExporter.whisper(availability.signal).then(setTools).catch(() => {
      if (!availability.signal.aborted) setTools(null)
    })
    function release() {
      const operation = active.current
      if (!operation) return
      operation.controller.abort()
      if (operation.id) void localExporter.release(operation.id)
    }
    window.addEventListener('pagehide', release)
    return () => {
      availability.abort()
      release()
      window.removeEventListener('pagehide', release)
    }
  }, [])

  async function start() {
    if (!file || !duration || active.current) return
    const operation: Operation = { controller: new AbortController() }
    const signal = operation.controller.signal
    active.current = operation
    setError(undefined)
    setNotice('')
    setProgress(0)
    setPhase('transfer')
    try {
      operation.id = (await localExporter.createTranscript(file, language, device)).id
      signal.throwIfAborted()
      await localExporter.upload(operation.id, file, signal, setProgress)
      setProgress(0)
      setPhase('recognition')
      while (!signal.aborted) {
        const job = await localExporter.status(operation.id, signal)
        if (job.phase === 'failed') throw new ExportClientError(job.error ?? 'transcriptFailed')
        setProgress(job.progress)
        if (job.phase === 'ready') {
          const output = await localExporter.transcript(operation.id, signal)
          signal.throwIfAborted()
          setCues(output.cues.map(cue => cue.end > duration
            ? { ...cue, end: duration, words: undefined } : cue).filter(cue => cue.end > cue.start))
          setResult(output)
          setPage(0)
          if (!output.cues.length) setNotice('empty')
          break
        }
        await new Promise(resolve => setTimeout(resolve, 350))
      }
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof ExportClientError ? reason.code : 'serviceError')
    } finally {
      if (operation.id) await localExporter.release(operation.id)
      setPhase('idle')
      if (signal.aborted) setNotice('cancelled')
      active.current = null
    }
  }

  function cancel() {
    const operation = active.current
    if (!operation) return
    setPhase('cancelling')
    operation.controller.abort()
  }

  async function selectModel() {
    if (!window.viralCutDesktop || selectingModel) return
    setSelectingModel(true)
    setModelIssue(false)
    try {
      const result = await window.viralCutDesktop.chooseModel(document.documentElement.lang)
      if (result === 'ready') setTools(await localExporter.whisper(AbortSignal.timeout(10000)))
      if (result === 'invalid' || result === 'error') setModelIssue(true)
    } catch {
      setModelIssue(true)
    } finally {
      setSelectingModel(false)
    }
  }

  function edit(index: number, cue: Cue) {
    setCues(cues.map((item, i) => i === index ? { ...cue, words: undefined } : item))
  }

  function changeTiming(index: number, endpoint: 'start' | 'end', raw: string) {
    const value = raw.trim() ? Number(raw.replace(',', '.')) : NaN
    const cue = { ...cues[index], [endpoint]: value }
    if (!Number.isFinite(value) || cue.start < 0 || cue.end > duration + .0005 || cue.start >= cue.end) {
      setNotice('range')
      return
    }
    cue.end = Math.min(duration, cue.end)
    if (cue.end <= cue.start) return
    setNotice('')
    if (cue[endpoint] !== cues[index][endpoint]) edit(index, cue)
  }

  const filename = file?.name.replace(/\.(mp4|webm)$/i, '') ?? 'subtitles'
  const readyCues = cues.filter(cue => cue.text.trim())

  return (
    <section className="panel subtitles-panel" aria-labelledby="subtitle-heading">
      <header className="panel-header"><h2 id="subtitle-heading"><AudioLines size={17} />{copy.aiSubtitles}</h2></header>
      <div className="subtitle-workspace">
        <div className="subtitle-toolbar">
          <label>{copy.spokenLanguage}<select aria-label={copy.spokenLanguage} value={language} disabled={busy} onChange={e => setLanguage(e.target.value as typeof language)}>
            <option value="auto">{copy.languageAuto}</option><option value="tr">Türkçe</option><option value="en">English</option>
          </select></label>
          <label>{copy.processor}<select aria-label={copy.processor} value={device} disabled={busy} onChange={e => setDevice(e.target.value as typeof device)}>
            <option value="auto">{copy.deviceAuto}</option><option value="cpu">CPU</option>
          </select></label>
          <button className="primary" type="button" disabled={!duration || !tools?.available || busy} onClick={() => void start()}>{copy.generateSubtitles}</button>
          {busy && <button className="export-cancel" type="button" disabled={phase === 'cancelling'} onClick={cancel}>{copy.exportCancel}</button>}
        </div>
        {(tools === null || tools?.mediaAvailable === false) && <p>{copy.exportErrors.toolsUnavailable}</p>}
        {tools?.mediaAvailable && !tools.modelPresent && (window.viralCutDesktop
          ? <div className="subtitle-toolbar"><p>{copy.desktopModelMissing}</p>
              <button className="export-cancel" type="button" disabled={selectingModel} onClick={() => void selectModel()}>{copy.desktopChooseModel}</button>
            </div>
          : <p>{copy.whisperSetup}</p>)}
        {modelIssue && <p role="alert">{copy.desktopModelInvalid}</p>}
        {tools?.mediaAvailable && tools.modelPresent && !tools.enginePresent && <p>{copy.whisperMissing}</p>}
        {busy && <div className="export-progress" role="status">
          <span>{phase === 'transfer' ? copy.exportPreparing : phase === 'cancelling' ? copy.cancelling : copy.recognizing}</span>
          <progress value={progress} max={100} aria-label={copy.exportProgress} /> <span>{Math.floor(progress)}%</span>
        </div>}
        {result && <p role="status">{copy.recognitionResult} {result.languages.join(', ') || '—'} · {result.backend}</p>}
        {notice && <p role={notice === 'range' ? 'alert' : 'status'}>{notice === 'empty' ? copy.noSpeech : notice === 'range' ? copy.invalidRange : copy.transcriptCancelled}</p>}
        {error && <p role="alert">{copy.exportErrors[error] ?? copy.exportErrors.serviceError}</p>}
        <CaptionStudio language={uiLanguage} appearance={appearance} apply={setAppearance} />
        {file && <details className="subtitle-settings" open={cues.length > 0 || undefined}>
          <summary>{copy.captionAppearance}</summary>
          <div className="subtitle-toolbar">
            <label>{copy.captionStyle}<select aria-label={copy.captionStyle} value={appearance.style} onChange={e => setAppearance(updateStyle(appearance, e.target.value as Appearance['style']))}>
              <option value="classic">{copy.classic}</option><option value="bold">{copy.bold}</option><option value="box">{copy.box}</option>
            </select></label>
            <label>{copy.captionFont}<select aria-label={copy.captionFont} value={appearance.font} onChange={e => setAppearance({ ...appearance, font: e.target.value as Appearance['font'] })}>
              <option value="arial">Arial</option><option value="segoe">Segoe UI</option><option value="verdana">Verdana</option>
            </select></label>
            <label>{copy.captionSize}<input type="range" min="22" max="100" value={appearance.size}
              onChange={e => setAppearance({ ...appearance, size: e.target.valueAsNumber })} /><output>{appearance.size}</output></label>
            <label>{copy.captionPosition}<select aria-label={copy.captionPosition} value={appearance.position} onChange={e => setAppearance({ ...appearance, position: e.target.value as Appearance['position'] })}>
              <option value="top">{copy.positionTop}</option><option value="middle">{copy.positionMiddle}</option><option value="bottom">{copy.positionBottom}</option>
            </select></label>
            {(['textColor', 'backgroundColor', 'highlightColor'] as const).map(key => (
              <label key={key}>{copy[key]}<input type="color" value={appearance[key]} onChange={e => setAppearance({ ...appearance, [key]: e.target.value })} /></label>
            ))}
          </div>
          <label className="export-option"><input type="checkbox" checked={appearance.highlight}
            onChange={e => setAppearance({ ...appearance, highlight: e.target.checked })} />{copy.wordHighlight}</label>
          {cues.length > 0 && <p>{wordCount}/{cues.length} · {wordCount ? copy.wordEstimated : copy.wordUnavailable}</p>}
        </details>}
        {duration > 0 && <div className="subtitle-toolbar">
          <button className="export-cancel" type="button" disabled={busy || cues.length >= 10000} onClick={() => {
            const start = Math.max(0, Math.min(editor.element.current?.currentTime ?? editor.time, duration - 0.1))
            setCues([...cues, { start, end: Math.min(duration, start + 2), text: '' }])
            setPage(Math.floor(cues.length / pageSize))
          }}><Plus size={15} />{copy.addSubtitle}</button>
          {(['srt', 'vtt'] as const).map(kind => <button type="button" key={kind} className="export-cancel"
            disabled={!readyCues.length} onClick={() => saveText(readyCues, kind, filename)}><Download size={15} />{kind.toUpperCase()}</button>)}
        </div>}
        {cues.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((cue, offset) => {
          const index = currentPage * pageSize + offset
          return <div className="subtitle-row" key={index}>
            <button type="button" className="export-cancel" onClick={() => editor.seek(cue.start)}>{timecode(cue.start)}</button>
            {(['start', 'end'] as const).map(endpoint => (
              <input key={endpoint + cue[endpoint]} type="text" inputMode="decimal" defaultValue={Number(cue[endpoint].toFixed(3))}
                aria-label={copy[endpoint] + ' ' + (index + 1)} disabled={busy}
                onBlur={e => {
                  changeTiming(index, endpoint, e.target.value)
                  e.target.value = String(Number(cue[endpoint].toFixed(3)))
                }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            ))}
            <textarea aria-label={copy.captionText + ' ' + (index + 1)} rows={1} maxLength={500} value={cue.text} disabled={busy}
              onChange={e => edit(index, { ...cue, text: e.target.value })} />
            <button className="export-cancel" type="button" aria-label={copy.removeSubtitle + ' ' + (index + 1)} disabled={busy}
              onClick={() => setCues(cues.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
          </div>
        })}
        {totalPages > 1 && <div className="subtitle-toolbar">
          <button className="export-cancel" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{copy.previousPage}</button>
          <span>{currentPage + 1} / {totalPages}</span>
          <button className="export-cancel" type="button" disabled={currentPage + 1 === totalPages} onClick={() => setPage(currentPage + 1)}>{copy.nextPage}</button>
        </div>}
      </div>
    </section>
  )
}
