import { useEffect, useState } from 'react'
import type { Copy } from '../i18n'
import type { PreviewKind, PreviewResult, ProjectMedia, Waveform } from './model'

export function MediaPreparation({ media, copy, proxy, toggleProxy, setWaveform, kind }: {
  media?: ProjectMedia; copy: Copy; proxy: boolean; toggleProxy: () => void; kind: PreviewKind
  setWaveform: (id: string, waveform: Waveform) => void
}) {
  const bridge = window.viralCutDesktop?.projects
  const [result, setResult] = useState<PreviewResult>({})
  const id = media?.id
  const busy = result.phase === 'running' || result.phase === 'queued'

  useEffect(() => {
    if (!id || !bridge) return
    let stopped = false
    let timer: number | undefined
    async function poll() {
      try {
        const next = await bridge!.previewStatus(id!, kind)
        if (stopped) return
        setResult(next)
        if (next.phase === 'ready' && next.peaks && next.step) setWaveform(id!, { peaks: next.peaks, step: next.step })
        if (next.phase === 'running' || next.phase === 'queued') timer = window.setTimeout(poll, 500)
      } catch { if (!stopped) setResult({ error: 'unavailable' }) }
    }
    void poll()
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [bridge, id, kind, setWaveform, busy])

  if (!bridge || !media || media.missing) return null
  const title = kind === 'waveform' ? copy.prepareWave : copy.preparePreview
  const submit = async () => {
    try { setResult(await (busy ? bridge.cancelPreview(media.id, kind) : bridge.prepare(media.id, kind))) }
    catch { setResult({ error: 'unavailable' }) }
  }
  return <div className="studio-preparation">
    <div className="shorts-actions">
      {result.phase !== 'ready' && <button className="export-cancel" onClick={() => void submit()}>{busy ? copy.exportCancel : title}</button>}
      {kind === 'proxy' && result.phase === 'ready' && <button className="export-cancel" aria-pressed={proxy} onClick={toggleProxy}>
        {proxy ? copy.originalPreview : copy.proxyPreview}</button>}
    </div>
    {busy && <div role="status" className="export-progress">
      {result.phase === 'queued' ? copy.previewQueued : copy.previewRunning}
      <progress aria-label={title} max={100} value={result.progress ?? 0} />
    </div>}
    {result.phase === 'cancelled' && <p role="status">{copy.exportCancelled}</p>}
    {(result.error || result.phase === 'failed') && <p role="alert">{result.error === 'queueFull' ? copy.exportErrors.busy : copy.previewFailed}</p>}
  </div>
}
