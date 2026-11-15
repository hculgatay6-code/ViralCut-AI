import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Copy } from '../i18n'
import type { Project } from './model'
import { ExportClientError, localExporter } from '../export/client'
import type { ExportJob } from '../export/client'

type Operation = { controller: AbortController; id?: string }

export function LayerOutput({ project, playhead, seek, monitor, tr, copy }: {
  project: Project; playhead: number; seek: (frame: number) => void
  monitor: HTMLDivElement | null; tr: boolean; copy: Copy
}) {
  const job = useRef<Operation | null>(null)
  const [state, setState] = useState<{ phase: 'rendering' | 'preview' | 'ready' | 'saving'; status?: ExportJob; from?: number }>()
  const [notice, setNotice] = useState('')
  const [failure, setFailure] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const total = Math.max(0, ...project.timeline!.tracks.flatMap(track => track.clips.map(clip => clip.at + clip.length)))
  const fps = project.timeline!.fps

  function release() {
    const current = job.current
    job.current = null
    current?.controller.abort()
    if (video.current) { video.current.pause(); video.current.removeAttribute('src'); video.current.load() }
    if (current?.id) return localExporter.release(current.id)
  }

  useEffect(() => {
    setState(undefined)
    setNotice('')
    return () => { void release() }
  }, [project.timeline, project.media, project.profile, project.appearance, project.encoder, project.frame, project.burn])

  async function start(preview: boolean) {
    if (!total || state?.phase === 'rendering' || state?.phase === 'saving') return
    if (preview && state?.phase === 'preview' && state.from !== undefined && video.current &&
        playhead >= state.from && playhead < Math.min(total, state.from + 8 * fps)) {
      video.current.currentTime = (playhead - state.from) / fps
      return
    }
    const prior = release()
    const active = { controller: new AbortController() } as Operation
    job.current = active
    const { signal } = active.controller
    const from = Math.min(playhead, total - 1)
    setState({ phase: 'rendering' }); setNotice(''); setFailure(false)
    try {
      await prior
      signal.throwIfAborted()
      active.id = (await localExporter.createLayers(project, preview ? { from, to: Math.min(total, from + 8 * fps) } : undefined)).id
      while (!signal.aborted) {
        const status = await localExporter.status(active.id, signal)
        signal.throwIfAborted()
        if (status.phase === 'failed') throw new ExportClientError(status.error ?? 'encodeFailed')
        if (status.phase === 'ready') {
          setState({ phase: preview ? 'preview' : 'ready', status, from: preview ? from : undefined })
          return
        }
        setState({ phase: 'rendering', status })
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    } catch (error) {
      if (!signal.aborted) {
        setFailure(true)
        setNotice(copy.exportErrors[error instanceof ExportClientError ? error.code : 'serviceError'] ?? copy.exportErrors.serviceError)
        setState(undefined)
        await release()
      }
    } finally {
      // A cancel can arrive before the service has returned the newly created job ID.
      if (signal.aborted && active.id) await localExporter.release(active.id)
    }
  }

  async function save() {
    if (!job.current?.id || state?.phase !== 'ready') return
    const active = job.current
    setState({ ...state, phase: 'saving' }); setNotice(''); setFailure(false)
    try {
      const saved = await localExporter.save(active.id!, 'ViralCut-v21-timeline.mp4', active.controller.signal)
      if (job.current !== active) return
      setNotice(copy.exportSaved + ' ' + saved.filename)
      setState(undefined)
      await release()
    } catch (error) {
      if (job.current !== active) return
      setState(state)
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setFailure(true)
        setNotice(copy.exportErrors[error instanceof ExportClientError ? error.code : 'saveFailed'] ?? copy.exportErrors.saveFailed)
      }
    }
  }

  const canStart = !!total && state?.phase !== 'rendering' && state?.phase !== 'saving'
  const status = state?.status
  const player = state?.phase === 'preview' && <div className="layer-monitor">
    <div><strong>{tr ? 'Birleşik önizleme' : 'Composite preview'}</strong>
      <button type="button" onClick={() => { void release(); setState(undefined) }}>{tr ? 'Kapat' : 'Close'}</button></div>
    <video ref={video} src={localExporter.monitorUrl(state.status!.id)} controls preload="metadata" playsInline
      onTimeUpdate={event => seek(Math.min(total, state.from! + Math.floor(event.currentTarget.currentTime * fps)))}
      onError={() => { void release(); setState(undefined); setFailure(true); setNotice(copy.exportErrors.jobMissing) }} />
  </div>

  return <div className="layer-output">
    <div className="layer-tools">
      <button type="button" disabled={!canStart} onClick={() => void start(true)}>{tr ? 'Buradan 8 sn önizle' : 'Preview 8 s from playhead'}</button>
      <button type="button" className="primary" disabled={!canStart} onClick={() => void start(false)}>{tr ? 'Katmanları MP4 hazırla' : 'Render layers to MP4'}</button>
      {state?.phase === 'ready' && <button type="button" className="primary" onClick={() => void save()}>{copy.saveSequence}</button>}
      {!!state && state.phase !== 'preview' && state.phase !== 'saving' && <button type="button"
        onClick={() => { void release(); setState(undefined); setNotice(copy.exportCancel) }}>{copy.exportCancel}</button>}
      {state?.phase === 'rendering' && <label role="status">{status?.waiting ? (tr ? 'Sırada' : 'Queued') : copy.exportProcessing}
        <progress max={100} value={status?.progress ?? 0} /> {Math.floor(status?.progress ?? 0)}%</label>}
      {status?.verification && <span>{copy.verifiedOutput} · {status.verification.width}×{status.verification.height} · {status.encoder}</span>}
    </div>
    {notice && <p role={failure ? 'alert' : 'status'}>{notice}</p>}
    {player && (monitor ? createPortal(player, monitor) : player)}
  </div>
}
