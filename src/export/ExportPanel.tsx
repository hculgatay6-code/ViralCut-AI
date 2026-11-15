import { useEffect, useRef, useState } from 'react'
import { Download, Film, X } from 'lucide-react'
import type { Copy } from '../i18n'
import { timecode } from '../editor/model'
import type { ClipRange } from '../editor/model'
import { ExportClientError, localExporter, normalizeFilename } from './client'
import type { ExportErrorCode, ExportJob } from './client'
import type { Overlay } from '../subtitles/model'
import type { Edit } from '../editor/shorts'
import { defaultProfile } from '../project/model'
import { ProfileFields } from '../project/ProjectPanel'

type Phase = 'idle' | 'receiving' | 'processing' | 'cancelling' | 'ready' | 'saving' | 'saved' | 'downloaded'
interface Operation { controller: AbortController; file: File; range: ClipRange; id?: string }
import type { StudioEffects } from '../editor/effects'

interface Props { file?: File; range: ClipRange; enabled: boolean; copy: Copy; overlay?: Overlay; edit?: Edit; effects?: StudioEffects }

function abortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function ExportPanel({ file, range, enabled, copy, overlay, edit, effects }: Props) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [nameOverride, setName] = useState<{ source: File | undefined; value: string }>()
  const [exportError, setExportError] = useState<ExportErrorCode>()
  const [savedName, setSavedName] = useState('')
  const [notice, setNotice] = useState(false)
  const [burn, setBurn] = useState(true)
  const [encoder, setEncoder] = useState<string>()
  const [verification, setVerification] = useState<ExportJob['verification']>()
  const [profile, setProfile] = useState(defaultProfile)
  const [custom, setCustom] = useState(false)
  const [eta, setEta] = useState<number>()
  const active = useRef<Operation | null>(null)
  const nameSource = active.current?.file ?? file
  const name = nameOverride && nameOverride.source === nameSource
    ? nameOverride.value
    : nameSource ? nameSource.name.replace(/\.(mp4|webm)$/i, '') + '-clip.mp4' : ''
  const processing = phase === 'receiving' || phase === 'processing'
  const retained = processing || phase === 'cancelling' || phase === 'ready' || phase === 'saving'

  useEffect(() => {
    const check = new AbortController()
    localExporter.available(check.signal).then(setAvailable).catch(() => {
      if (!check.signal.aborted) setAvailable(false)
    })
    function release() {
      const operation = active.current
      if (!operation) return
      operation.controller.abort()
      if (operation.id) void localExporter.release(operation.id)
    }
    window.addEventListener('pagehide', release)
    return () => {
      check.abort()
      window.removeEventListener('pagehide', release)
      release()
    }
  }, [])

  async function cancel() {
    const operation = active.current
    if (!operation) return
    operation.controller.abort()
    setPhase('cancelling')
    if (operation.id) {
      setNotice(true)
      await localExporter.release(operation.id)
      if (active.current === operation) {
        active.current = null
        setPhase('idle')
      }
    }
  }

  async function start() {
    if (!file || !enabled || active.current) return
    if (!normalizeFilename(name)) {
      setExportError('invalidName')
      return
    }

    const operation: Operation = { controller: new AbortController(), file, range }
    active.current = operation
    const signal = operation.controller.signal
    setExportError(undefined)
    setNotice(false)
    setProgress(0)
    setEncoder(undefined)
    setVerification(undefined)
    setEta(undefined)
    setPhase('receiving')
    let ready = false
    try {
      const { id } = await localExporter.create(file, range, burn ? overlay : undefined, edit, custom ? profile : undefined, effects)
      operation.id = id
      signal.throwIfAborted()
      await localExporter.upload(id, file, signal, setProgress)

      setProgress(0)
      setPhase('processing')
      const started = performance.now()
      while (!signal.aborted) {
        const job = await localExporter.status(id, signal)
        setProgress(job.progress)
        setEta(job.progress > 3 && job.progress < 93
          ? Math.ceil((performance.now() - started) / 1000 * (100 - job.progress) / job.progress) : undefined)
        if (job.phase === 'failed') throw new ExportClientError(job.error ?? 'encodeFailed')
        if (job.phase === 'ready') {
          setEncoder(job.encoder)
          setVerification(job.verification)
          ready = true
          setPhase('ready')
          return
        }
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    } catch (error) {
      if (!signal.aborted) setExportError(error instanceof ExportClientError ? error.code : 'serviceError')
    } finally {
      if (!ready) {
        if (operation.id) await localExporter.release(operation.id)
        if (active.current === operation) {
          active.current = null
          if (signal.aborted) setNotice(true)
          setPhase('idle')
        }
      }
    }
  }

  async function save() {
    const operation = active.current
    if (!operation?.id) return
    const filename = normalizeFilename(name)
    if (!filename) {
      setExportError('invalidName')
      return
    }
    setExportError(undefined)
    setPhase('saving')
    try {
      const result = await localExporter.save(operation.id, filename, operation.controller.signal)
      if (result.confirmed) await localExporter.release(operation.id)
      if (active.current !== operation || operation.controller.signal.aborted) return
      active.current = null
      setSavedName(result.filename)
      setPhase(result.confirmed ? 'saved' : 'downloaded')
    } catch (error) {
      if (active.current !== operation || operation.controller.signal.aborted) return
      const expired = error instanceof ExportClientError && error.code === 'jobMissing'
      if (expired) active.current = null
      setPhase(expired ? 'idle' : 'ready')
      if (!abortError(error)) setExportError(expired ? 'jobMissing' : 'saveFailed')
    }
  }

  return (
    <section className="panel export-panel" aria-labelledby="export-heading">
      <header className="panel-header"><h2 id="export-heading"><Film size={17} />{copy.exportHeading}</h2></header>
      <div className="export-body">
        <label htmlFor="export-name">{copy.exportName}</label>
        <input id="export-name" type="text" value={name} maxLength={154} placeholder="clip.mp4"
          disabled={(!enabled && !retained) || processing || phase === 'saving'}
          onChange={event => {
            setName({ source: nameSource, value: event.target.value })
            if (exportError === 'invalidName') setExportError(undefined)
          }} />
        {available === false && <p>{copy.exportErrors.toolsUnavailable}</p>}
        {enabled && <label className="export-option"><input type="checkbox" checked={custom} disabled={retained}
          onChange={event => setCustom(event.target.checked)} />{copy.useProfile}</label>}
        {custom && enabled && !retained && <ProfileFields profile={profile} set={setProfile} copy={copy} />}
        {overlay && <label className="export-option">
          <input type="checkbox" checked={burn} disabled={retained} onChange={event => setBurn(event.target.checked)} />
          {copy.burnSubtitles}
        </label>}
        {processing && (
          <div className="export-progress" aria-live="polite">
            <span>{phase === 'receiving' ? copy.exportPreparing : copy.exportProcessing}</span>
            <progress value={progress} max={100} aria-label={copy.exportProgress} />
            <span>{Math.floor(progress)}%</span>
            {phase === 'processing' && eta !== undefined && <span>{copy.eta} {timecode(eta, false)}</span>}
          </div>
        )}
        {!retained && enabled && phase === 'idle' && <p>{copy.selection} · {timecode(range.end - range.start)}</p>}
        {retained && active.current && <p>{active.current.file.name} · {timecode(active.current.range.start)} – {timecode(active.current.range.end)}</p>}
        {encoder && <p>{copy.encodingMode} · {encoder}</p>}
        {verification && <p>{copy.verifiedOutput} · {verification.width} × {verification.height} · {verification.fps} FPS · {' '}
          {timecode(verification.duration)} · H.264{verification.audio && '/AAC'}{verification.captions && ' · ' + copy.burnSubtitles}</p>}
        <div className="export-actions">
          {phase === 'ready' || phase === 'saving'
            ? <button type="button" className="primary" disabled={phase === 'saving'} onClick={() => void save()}>
                <Download size={16} />{phase === 'saving' ? copy.exportSaving : copy.exportSave}
              </button>
            : <button type="button" className="primary" disabled={!available || !enabled || processing} onClick={() => void start()}>
                <Download size={16} />{copy.exportStart}
              </button>}
          {retained && <button type="button" className="export-cancel" onClick={() => void cancel()}>
            <X size={15} />{copy.exportCancel}
          </button>}
        </div>
        {exportError && <p className="export-error" role="alert">{copy.exportErrors[exportError] ?? copy.exportErrors.serviceError}</p>}
        <div className="export-status" role="status">
          {phase === 'cancelling' && copy.cancelling}
          {phase === 'ready' && copy.exportReady}
          {phase === 'saved' && copy.exportSaved + ' ' + savedName}
          {phase === 'downloaded' && copy.exportDownloaded + ' ' + savedName}
          {notice && phase === 'idle' && copy.exportCancelled}
        </div>
      </div>
    </section>
  )
}
