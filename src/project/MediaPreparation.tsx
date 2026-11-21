import { useEffect, useState } from 'react'
import type { Copy } from '../i18n'
import type { PreviewKind, PreviewResult, ProjectMedia, ProxyResolution, Waveform } from './model'

export function MediaPreparation({ media, copy, proxy, selectProxy, setWaveform, kind, tr }: {
  media?: ProjectMedia; copy: Copy; proxy?: ProxyResolution; selectProxy: (height?: ProxyResolution) => void; kind: PreviewKind; tr: boolean
  setWaveform: (id: string, waveform: Waveform) => void
}) {
  const bridge = window.viralCutDesktop?.projects
  const [result, setResult] = useState<PreviewResult>({})
  const [height, setHeight] = useState<ProxyResolution>(360)
  const [device, setDevice] = useState<'auto' | 'cpu'>('auto')
  const [submitting, setSubmitting] = useState(false)
  const id = media?.id
  const busy = result.phase === 'running' || result.phase === 'queued'

  useEffect(() => {
    if (!id || !bridge) return
    let stopped = false
    let timer: number | undefined
    async function poll() {
      try {
        const next = await bridge!.previewStatus(id!, kind, height)
        if (stopped) return
        setResult(next)
        if (next.phase === 'ready' && next.peaks && next.step) setWaveform(id!, { peaks: next.peaks, step: next.step })
        if (next.phase === 'running' || next.phase === 'queued') timer = window.setTimeout(poll, 500)
      } catch { if (!stopped) setResult({ error: 'unavailable' }) }
    }
    void poll()
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [bridge, id, kind, setWaveform, busy, height, proxy])

  if (!bridge || !media || media.missing || (kind === 'proxy' && media.audioOnly)) return null
  const title = kind === 'waveform' ? copy.prepareWave : copy.preparePreview
  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    try { setResult(await (busy ? bridge.cancelPreview(media.id, kind, height) : bridge.prepare(media.id, kind, height, device))) }
    catch { setResult({ error: 'unavailable' }) }
    finally { setSubmitting(false) }
  }
  return <div className="studio-preparation">
    <div className="shorts-actions">
      {kind === 'proxy' && <>
        <label>{tr ? 'Proxy çözünürlüğü' : 'Proxy resolution'} <select value={height} disabled={submitting} onChange={event => {
          setHeight(Number(event.target.value) as ProxyResolution)
          setResult({})
        }}><option value={360}>360p</option><option value={540}>540p</option><option value={720}>720p</option></select></label>
        <label>{tr ? 'Proxy kodlayıcı' : 'Proxy encoder'} <select value={device} disabled={busy || submitting}
          onChange={event => setDevice(event.target.value === 'cpu' ? 'cpu' : 'auto')}>
          <option value="auto">{tr ? 'Otomatik (NVENC varsa)' : 'Auto (NVENC if available)'}</option><option value="cpu">CPU</option>
        </select></label>
      </>}
      {result.phase !== 'ready' && <button className="export-cancel" disabled={submitting} onClick={() => void submit()}>
        {busy ? copy.exportCancel : result.phase === 'cancelled' && kind === 'proxy' ? (tr ? 'Proxy’yi yeniden başlat' : 'Restart proxy') : title}</button>}
      {kind === 'proxy' && result.phase === 'ready' && <button className="export-cancel" aria-pressed={proxy === height}
        onClick={() => selectProxy(proxy === height ? undefined : height)}>
        {proxy === height ? copy.originalPreview : copy.proxyPreview + ' · ' + height + 'p'}</button>}
      {kind === 'proxy' && proxy && proxy !== height && <button className="export-cancel" onClick={() => selectProxy()}>{copy.originalPreview}</button>}
      {kind === 'proxy' && result.phase === 'ready' && <small>
        {result.width && result.height ? result.width + '×' + result.height : height + 'p'}{result.encoder && ' · ' + result.encoder}
        {result.cached && (tr ? ' · Önbellekte' : ' · Cached')}
      </small>}
    </div>
    {busy && <div role="status" className="export-progress">
      {result.phase === 'queued' ? copy.previewQueued : copy.previewRunning}
      <progress aria-label={title} max={100} value={result.progress ?? 0} />
    </div>}
    {result.phase === 'cancelled' && <p role="status">{copy.exportCancelled}</p>}
    {(result.error || result.phase === 'failed') && <p role="alert">{result.error === 'queueFull' ? copy.exportErrors.busy
      : result.error === 'proxyLimit' ? (tr ? 'Bu video proxy önbelleği sınırını aşıyor. Daha düşük çözünürlük seç.' : 'This video exceeds the proxy cache limit. Choose a lower resolution.')
      : result.error === 'proxyHdr' ? (tr ? 'HDR video için özgün önizleme kullanılır.' : 'HDR video uses original preview.')
      : copy.exportErrors[result.error as keyof typeof copy.exportErrors] ?? copy.previewFailed}</p>}
  </div>
}
