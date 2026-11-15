import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { AudioLines, Crop, Scissors } from 'lucide-react'
import type { Copy } from '../i18n'
import type { ClipRange } from '../editor/model'
import { timecode } from '../editor/model'
import type { VideoEditor } from '../editor/useVideo'
import type { Cue } from '../subtitles/model'
import { ExportClientError, localExporter } from '../export/client'
import type { ExportErrorCode } from '../export/client'
import { defaultFrame, sizes, suggestClips } from '../editor/shorts'
import type { Edit } from '../editor/shorts'

interface Props {
  editor: VideoEditor
  copy: Copy
  cues: Cue[]
  edit: Edit
  changeEdit: (edit: Edit) => void
  clearRemoval: () => void
  setMarkers: (value: ClipRange[]) => void
  preview: boolean
  setPreview: (value: boolean) => void
  playCandidate: (range: ClipRange) => void
  applyCandidate: (range: ClipRange) => void
}
interface AnalysisJob { controller: AbortController; id?: string }

export function ShortsPanel({ editor, copy, cues, edit, changeEdit, clearRemoval, setMarkers, preview, setPreview, playCandidate, applyCandidate }: Props) {
  const [threshold, setThreshold] = useState(-38)
  const [minimum, setMinimum] = useState(0.65)
  const [padding, setPadding] = useState(0.18)
  const [phase, setPhase] = useState<'idle' | 'transfer' | 'scan' | 'cancelling'>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<ExportErrorCode>()
  const [result, setResult] = useState<{ silences: ClipRange[]; truncated: boolean }>()
  const [cancelled, setCancelled] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [page, setPage] = useState(0)
  const [target, setTarget] = useState(30)
  const frame = edit.frame ?? defaultFrame
  const { source, metadata } = editor
  const duration = metadata?.duration ?? 0
  const operation = useRef<AnalysisJob | null>(null)
  const silences = result?.silences
  const suggestions = useMemo(() => suggestClips(cues, silences ?? [], target, duration), [cues, silences, target, duration])

  const startAnalysis = useEffectEvent(() => { void runAnalysis(true) })
  useEffect(() => {
    if (!source || !duration) return
    const timer = window.setTimeout(() => startAnalysis(), 400)
    return () => clearTimeout(timer)
  }, [source, duration])
  useEffect(() => {
    function abort() {
      const active = operation.current
      active?.controller.abort()
      if (active?.id) void localExporter.release(active.id)
    }
    window.addEventListener('pagehide', abort)
    return () => { window.removeEventListener('pagehide', abort); abort() }
  }, [])

  async function runAnalysis(automatic: boolean) {
    if (!source || !duration || operation.current) return
    const active: AnalysisJob = { controller: new AbortController() }
    operation.current = active
    const signal = active.controller.signal
    setPhase('transfer')
    setProgress(0)
    setError(undefined)
    setCancelled(false)
    try {
      active.id = (await localExporter.createSilence(source.file, threshold, minimum, automatic)).id
      signal.throwIfAborted()
      await localExporter.upload(active.id, source.file, signal, setProgress)
      setPhase('scan')
      setProgress(0)
      while (!signal.aborted) {
        const status = await localExporter.status(active.id, signal)
        setProgress(status.progress)
        if (status.phase === 'failed') throw new ExportClientError(status.error ?? 'encodeFailed')
        if (status.phase === 'ready') {
          const output = await localExporter.silences(active.id, signal)
          signal.throwIfAborted()
          setResult(output)
          setMarkers(output.silences)
          setSelected([])
          clearRemoval()
          setPage(0)
          break
        }
        await new Promise(resolve => setTimeout(resolve, 220))
      }
    } catch (reason) {
      const code = reason instanceof ExportClientError ? reason.code : 'serviceError'
      if (!signal.aborted && !(automatic && (code === 'busy' || code === 'jobMissing' || code === 'noAudio'))) setError(code)
    } finally {
      if (active.id) await localExporter.release(active.id)
      operation.current = null
      setPhase('idle')
      if (signal.aborted) setCancelled(true)
    }
  }


  function selectRegions(indices: number[], gap = padding) {
    const next = indices.slice(0, 500)
    setSelected(next)
    const remove = next.sort((a, b) => a - b).map(index => silences![index])
      .map(span => ({ start: span.start + (span.start > 0.01 ? gap : 0),
        end: span.end - (span.end < duration - 0.01 ? gap : 0) })).filter(span => span.end - span.start >= 0.01)
    changeEdit({ ...edit, remove })
  }

  return <section className="panel shorts-panel" aria-label={copy.shortsHeading}>
    <header className="panel-header"><h2><Scissors size={17} />{copy.shortsHeading}</h2></header>
    <div className="shorts-grid">
      <section aria-labelledby="silence-heading">
        <h3 id="silence-heading"><AudioLines size={16} />{copy.silenceHeading}</h3>
        <div className="shorts-controls">
          <label>{copy.silenceThreshold}<input type="number" min={-65} max={-12} step={1} value={threshold}
            onChange={event => setThreshold(event.target.valueAsNumber || -38)} /></label>
          <label>{copy.silenceMinimum}<input type="number" min={0.2} max={10} step={0.05} value={minimum}
            onChange={event => setMinimum(event.target.valueAsNumber || 0.65)} /></label>
          <label>{copy.silencePadding}<input type="number" min={0} max={1} step={0.05} value={padding}
            onChange={event => {
              const value = Math.min(1, Math.max(0, event.target.valueAsNumber || 0))
              setPadding(value)
              if (selected.length) selectRegions(selected, value)
            }} /></label>
        </div>
        <div className="shorts-actions">
          <button type="button" className="export-cancel" disabled={!duration || phase !== 'idle'} onClick={() => void runAnalysis(false)}>{copy.analyzeSilence}</button>
          {phase !== 'idle' && <button type="button" className="export-cancel" disabled={phase === 'cancelling'} onClick={() => {
            setPhase('cancelling'); operation.current?.controller.abort()
          }}>{copy.exportCancel}</button>}
          <button type="button" className="export-cancel" disabled={!silences?.length || phase !== 'idle'}
            onClick={() => selectRegions(selected.length ? [] : (silences ?? []).map((_, index) => index))}>
            {selected.length ? copy.clearSilences : copy.markSilences}
          </button>
        </div>
        {phase !== 'idle' && <div className="export-progress" role="status">
          {phase === 'transfer' ? copy.exportPreparing : phase === 'scan' ? copy.scanningSilence : copy.cancelling}
          <progress aria-label={copy.silenceHeading} value={progress} max={100} />
          {Math.floor(progress)}%
        </div>}
        {error && <p role="alert">{copy.exportErrors[error] ?? copy.exportErrors.serviceError}</p>}
        {cancelled && <p role="status">{copy.exportCancelled}</p>}
        {result && <p>{silences!.length} · {copy.silenceHeading}{result.truncated && ' · 4000 ' + copy.limitReached}</p>}
        {!!selected.length && <p>{copy.selectedSilence} · {edit.remove.length} · {copy.removeDuration} {timecode(edit.remove.reduce((sum, span) => sum + span.end - span.start, 0))}</p>}
        {!!silences?.length && <ul className="silence-list">
          {silences.slice(page * 8, (page + 1) * 8).map((span, offset) => {
            const index = page * 8 + offset
            return <li key={span.start}><label><input type="checkbox" checked={selected.includes(index)} onChange={event => {
              selectRegions(event.target.checked ? [...selected, index] : selected.filter(item => item !== index))
            }} />{timecode(span.start)} – {timecode(span.end)}</label>
            <button type="button" className="export-cancel" onClick={() => editor.seek(span.start)}>{copy.preview}</button></li>
          })}
        </ul>}
        {(silences?.length ?? 0) > 8 && <div className="shorts-actions">
          <button type="button" className="export-cancel" disabled={!page} onClick={() => setPage(page - 1)}>{copy.previousPage}</button>
          <span>{page + 1} / {Math.ceil(silences!.length / 8)}</span>
          <button type="button" className="export-cancel" disabled={(page + 1) * 8 >= silences!.length} onClick={() => setPage(page + 1)}>{copy.nextPage}</button>
        </div>}
      </section>

      <section aria-labelledby="frame-heading">
        <h3 id="frame-heading"><Crop size={16} />{copy.frameHeading}</h3>
        <label>{copy.shortsFormat}
          <select aria-label={copy.shortsFormat} disabled={!duration} value={edit.frame?.mode ?? 'source'} onChange={event => {
            const mode = event.target.value as 'source' | typeof frame.mode
            changeEdit({ ...edit, frame: mode === 'source' ? undefined : { ...frame, mode } })
          }}>
            <option value="source">{copy.sourceFormat}</option><option value="vertical">9:16 · 1080 × 1920</option>
            <option value="square">1:1 · 1080 × 1080</option><option value="landscape">16:9 · 1920 × 1080</option>
          </select>
        </label>
        {!!edit.frame && <div className="frame-controls">
          {(['zoom', 'x', 'y'] as const).map(key => <label key={key}>{copy[key]}<input type="range" aria-label={copy[key]}
            min={key === 'zoom' ? 1 : -1} max={key === 'zoom' ? 3 : 1} step={0.01} value={frame[key]}
            onChange={event => changeEdit({ ...edit, frame: { ...frame, [key]: Number(event.target.value) } })} /></label>)}
          {metadata && (metadata.width < sizes[frame.mode][0] || metadata.height < sizes[frame.mode][1] || frame.zoom > 1) && <p>{copy.scalingNotice}</p>}
        </div>}
        <label>{copy.encodingMode}<select aria-label={copy.encodingMode} value={edit.encoder}
          onChange={event => changeEdit({ ...edit, encoder: event.target.value as Edit['encoder'] })}>
          <option value="auto">{copy.encodingAuto}</option><option value="cpu">CPU</option></select></label>
        <div className="shorts-actions">
          <button type="button" className="export-cancel" aria-pressed={!preview} disabled={!duration} onClick={() => setPreview(false)}>{copy.beforePreview}</button>
          <button type="button" className="export-cancel" aria-pressed={preview} disabled={!duration} onClick={() => setPreview(true)}>{copy.afterPreview}</button>
        </div>
      </section>

      <section aria-labelledby="clips-heading">
        <h3 id="clips-heading"><Scissors size={16} />{copy.smartClips}</h3>
        <label>{copy.clipLength}<select aria-label={copy.clipLength} value={target} onChange={event => setTarget(Number(event.target.value))}>
          {[15, 30, 60].map(seconds => <option key={seconds} value={seconds}>{seconds} {copy.seconds}</option>)}
        </select></label>
        {!cues.length && <p>{copy.clipsNeedCaptions}</p>}
        {!!cues.length && !suggestions.length && <p>{copy.noClipCandidates}</p>}
        <ul className="clip-candidates">{suggestions.map((span, index) => <li key={span.start}>
          <strong>{index + 1} · {timecode(span.start)} – {timecode(span.end)}</strong><p>{span.text}</p>
          <div className="shorts-actions">
            <button type="button" className="export-cancel" onClick={() => playCandidate(span)}>{copy.preview}</button>
            <button type="button" className="export-cancel" onClick={() => applyCandidate(span)}>{copy.useCandidate}</button>
          </div>
        </li>)}</ul>
      </section>
    </div>
  </section>
}
