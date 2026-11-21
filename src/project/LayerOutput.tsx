import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Copy } from '../i18n'
import type { Project } from './model'
import { ExportClientError, localExporter } from '../export/client'
import type { ExportJob } from '../export/client'
import type { ProxyResolution } from './model'
import { frameCode, layerDuration } from './layer-model'

type Operation = { controller: AbortController; id?: string }

export function LayerOutput({ project, playhead, seek, monitor, tr, copy }: {
  project: Project; playhead: number; seek: (frame: number) => void
  monitor: HTMLDivElement | null; tr: boolean; copy: Copy
}) {
  const job = useRef<Operation | null>(null)
  const [state, setState] = useState<{ phase: 'rendering' | 'preview' | 'ready' | 'saving'; status?: ExportJob; range?: { from: number; to: number } }>()
  const [notice, setNotice] = useState('')
  const [failure, setFailure] = useState(false)
  const [proxy, setProxy] = useState<ProxyResolution>()
  const [seconds, setSeconds] = useState(8)
  const [loop, setLoop] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const video = useRef<HTMLVideoElement>(null)
  const lastFrame = useRef<number | null>(null)
  const total = layerDuration(project.timeline!)
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
  }, [project.timeline, project.media, project.profile, project.appearance, project.encoder, project.frame, project.burn, proxy, seconds])

  useEffect(() => {
    const player = video.current
    const range = state?.range
    if (!player || !range || lastFrame.current === playhead) return
    if (playhead < range.from || playhead >= range.to) {
      player.pause()
      return
    }
    if (player.readyState > 0) player.currentTime = (playhead - range.from) / fps
  }, [playhead, fps, state?.range])

  async function start(preview: boolean) {
    if (!total || state?.phase === 'rendering' || state?.phase === 'saving') return
    if (preview && state?.range && video.current && playhead >= state.range.from && playhead < state.range.to) {
      video.current.currentTime = (playhead - state.range.from) / fps
      return
    }
    const prior = release()
    const active = { controller: new AbortController() } as Operation
    job.current = active
    const { signal } = active.controller
    const from = Math.min(playhead, total - 1)
    const range = preview ? { from, to: Math.min(total, from + seconds * fps) } : undefined
    setState({ phase: 'rendering' }); setNotice(''); setFailure(false)
    setElapsed(0)
    const started = performance.now()
    try {
      await prior
      signal.throwIfAborted()
      active.id = (await localExporter.createLayers(project, range && { ...range, proxy })).id
      while (!signal.aborted) {
        const status = await localExporter.status(active.id, signal)
        signal.throwIfAborted()
        setElapsed((performance.now() - started) / 1000)
        if (status.phase === 'failed') throw new ExportClientError(status.error ?? 'encodeFailed')
        if (status.phase === 'ready') {
          setState({ phase: preview ? 'preview' : 'ready', status, range })
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
      const saved = await localExporter.save(active.id!, 'ViralCut-timeline.mp4', active.controller.signal)
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
  const percent = status?.progress ?? 0
  const eta = elapsed > 2 && percent >= 5 && percent < 96 && !status?.waiting
    ? Math.ceil(elapsed * (100 - percent) / percent) : undefined
  const range = state?.range
  const player = state?.phase === 'preview' && range && <div className="layer-monitor">
    <div><strong>{tr ? 'Birleşik önizleme' : 'Composite preview'}</strong>
      <span>{frameCode(range.from, fps)} – {frameCode(range.to, fps)}</span>
      <label><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} />{tr ? 'Döngü' : 'Loop'}</label>
      <button type="button" onClick={() => { void release(); setState(undefined) }}>{tr ? 'Kapat' : 'Close'}</button></div>
    <video ref={video} src={localExporter.monitorUrl(state.status!.id)} controls preload="metadata" playsInline loop={loop}
      onLoadedMetadata={event => {
        const frame = playhead >= range.from && playhead < range.to ? playhead : range.from
        event.currentTarget.currentTime = (frame - range.from) / fps
      }}
      onTimeUpdate={event => {
        const frame = Math.min(range.to - 1, range.from + Math.floor(event.currentTarget.currentTime * fps + 0.0001))
        lastFrame.current = frame
        seek(frame)
      }}
      onError={() => { void release(); setState(undefined); setFailure(true); setNotice(copy.exportErrors.jobMissing) }} />
  </div>

  return <div className="layer-output">
    <div className="layer-tools">
      <button type="button" disabled={!canStart} onClick={() => void start(true)}>
        {tr ? 'Buradan ' + seconds + ' sn önizle' : 'Preview ' + seconds + ' s from playhead'}</button>
      <label>{tr ? 'Önizleme süresi' : 'Preview length'} <select value={seconds} disabled={!canStart}
        onChange={event => setSeconds(Number(event.target.value))}>
        {[2, 4, 8].map(value => <option value={value} key={value}>{value} {tr ? 'sn' : 's'}</option>)}
      </select></label>
      <label>{tr ? 'Önizleme kaynağı' : 'Preview media'} <select value={proxy ?? 0} disabled={!canStart}
        onChange={event => setProxy(Number(event.target.value) as ProxyResolution || undefined)}>
        <option value={0}>{tr ? 'Özgün medya' : 'Original media'}</option>
        {[360, 540, 720].map(value => <option value={value} key={value}>Proxy {value}p</option>)}
      </select></label>
      <button type="button" className="primary" disabled={!canStart} onClick={() => void start(false)}>{tr ? 'Katmanları MP4 hazırla' : 'Render layers to MP4'}</button>
      {state?.phase === 'ready' && <button type="button" className="primary" onClick={() => void save()}>{copy.saveSequence}</button>}
      {!!state && state.phase !== 'preview' && state.phase !== 'saving' && <button type="button"
        onClick={() => { void release(); setState(undefined); setNotice(copy.exportCancel) }}>{copy.exportCancel}</button>}
      {state?.phase === 'rendering' && <label role="status">{status?.waiting ? (tr ? 'Sırada' : 'Queued') : copy.exportProcessing}
        <progress max={100} value={percent} /> {Math.floor(percent)}% · {elapsed.toFixed(1)} s
        {eta !== undefined && <span> · {tr ? 'Tahmini kalan' : 'Estimated remaining'} {eta} s</span>}</label>}
      {status?.verification && <span>{copy.verifiedOutput} · {status.verification.width}×{status.verification.height} · {status.encoder}</span>}
      {state?.phase === 'preview' && status?.cacheHit && <span role="status">{tr ? 'Önbellekten' : 'From cache'}</span>}
      {state?.phase === 'preview' && proxy && <span>{status?.proxyCount
        ? (tr ? 'Proxy kaynakları ' : 'Proxy sources ') + status.proxyCount
        : tr ? 'Bu aralıkta hazır proxy yok, özgün medya kullanıldı.' : 'Original media used in this range.'}</span>}
    </div>
    {notice && <p role={failure ? 'alert' : 'status'}>{notice}</p>}
    {player && (monitor ? createPortal(player, monitor) : player)}
  </div>
}
