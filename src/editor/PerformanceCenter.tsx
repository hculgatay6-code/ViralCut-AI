import { useEffect, useState } from 'react'
import type { Language } from '../i18n'
import type { BatchResult, ExportJob } from '../export/client'
import type { DiagnosticEntry } from './Diagnostics'

export interface PerformanceData {
  system: { cpu: number; ram: number; main: number; renderer: number; usedMiB: number; disk: number | null;
    gpu: { gpu: number | null; encode: number | null; decode: number | null; vram: number | null; vramTotal: number | null } | null;
    hardware: { status: string; nvenc: boolean; decode: string[]; scaleCuda: boolean; providers: string[] } }
  budget: { profile: string; active?: string; waiting: number; pressure: boolean; availableMiB: number; totalMiB: number }
  analysisCache: { entries: number; bytes: number; hits: number }
  activity: { operation?: string; job?: ExportJob; batch: BatchResult }
  recent: DiagnosticEntry[]
}

export function PerformanceCenter({ language }: { language: Language }) {
  const [data, setData] = useState<PerformanceData>()
  const [error, setError] = useState(false)
  const bridge = window.viralCutDesktop?.performance
  const l = (tr: string, en: string) => language === 'tr' ? tr : en
  useEffect(() => {
    let closed = false
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const sample = await bridge?.read()
        if (!closed && sample?.system) { setData(sample); setError(false) }
        else if (!closed) setError(true)
      } catch { if (!closed) setError(true) }
      if (!closed) timer = setTimeout(refresh, 1800)
    }
    void refresh()
    return () => { closed = true; clearTimeout(timer) }
  }, [bridge])
  const missing = l('Ölçülemiyor', 'Unavailable')
  const unit = (value: number | null | undefined, suffix: string) => value == null ? missing : String(value) + suffix
  const { system, budget, analysisCache, activity, recent } = data ?? {}
  const hardware = system?.hardware
  const task = (name?: string) => ({
    export: l('MP4 dışa aktarma', 'MP4 export'), sequence: l('Proje dışa aktarma', 'Project export'),
    batch: l('Toplu Shorts', 'Shorts batch'), 'shorts-analysis': l('AI video analizi', 'AI video analysis'),
    transcribe: l('Konuşma tanıma', 'Speech recognition'), silence: l('Sessizlik analizi', 'Silence analysis'),
  })[name ?? ''] ?? l('Beklemede', 'Idle')
  const latestExport = recent?.find(row => row.outcome === 'ready' && ['batch', 'export', 'sequence'].includes(row.operation))
  const clip = activity?.batch.items.filter(item => item.phase === 'ready').at(-1)
  return <section className="panel performance-panel" aria-label={l('Performans Merkezi', 'Performance Center')}>
    <header className="panel-header"><h2>{l('Performans Merkezi', 'Performance Center')}</h2></header>
    {error && <p role="alert">{l('Ölçümler okunamadı.', 'Metrics could not be read.')}</p>}
    {system && budget && <div className="auto-shorts-body">
      <label>{l('Performans profili', 'Performance profile')} <select value={budget.profile} onChange={event => {
        const profile = event.target.value
        setData(current => current && ({ ...current, budget: { ...current.budget, profile } }))
        void bridge?.profile(profile)
      }}><option value="eco">Eco</option><option value="balanced">Balanced</option><option value="performance">Performance</option></select></label>
      <dl className="performance-metrics">
        <div><dt>{l('Uygulama CPU', 'App CPU')}</dt><dd>{system.cpu}%</dd></div>
        <div><dt>{l('Sistem RAM', 'System RAM')}</dt><dd>{system.usedMiB} / {budget.totalMiB} MiB</dd></div>
        <div><dt>Electron</dt><dd>{system.ram} MiB · {l('Ana', 'Main')} {system.main} · {l('Arayüz', 'Renderer')} {system.renderer}</dd></div>
        <div><dt>GPU</dt><dd>{unit(system.gpu?.gpu, '%')}</dd></div>
        <div><dt>NVENC / NVDEC</dt><dd>{unit(system.gpu?.encode, '%')} / {unit(system.gpu?.decode, '%')}</dd></div>
        <div><dt>VRAM</dt><dd>{unit(system.gpu?.vram, ' MiB')} / {unit(system.gpu?.vramTotal, ' MiB')}</dd></div>
        <div><dt>{l('Geçici disk boş alanı', 'Temp storage free')}</dt><dd>{unit(system.disk, ' MiB')}</dd></div>
      </dl>
      <p>{l('Aktif görev', 'Active task')} · {task(budget.active)} {activity?.job && ' · ' + Math.round(activity.job.progress) + '%'}</p>
      <p>{l('Kuyruktaki görevler', 'Queued tasks')} · {budget.waiting + (activity?.batch.items.filter(item => item.phase === 'queued').length ?? 0)}</p>
      {budget.pressure && <p role="status">{l('Kullanılabilir bellek düşük. Yeni ağır görev bekletiliyor.', 'Available memory is low. New heavy work will wait.')}</p>}
      {hardware && <p>{hardware.status === 'checking' ? l('Donanım sınanıyor…', 'Testing hardware…') :
        hardware.status === 'unavailable' ? missing : 'H.264 NVENC: ' + (hardware.nvenc ? '✓' : '—') + ' · ' +
        l('Çözme', 'Decode') + ': ' + (hardware.decode.join(', ') || 'CPU') + ' · scale_cuda: ' + (hardware.scaleCuda ? '✓' : '—') +
        ' · ONNX: ' + (hardware.providers.join(', ') || l('Analiz bekleniyor', 'Awaiting analysis'))}</p>}
      {latestExport?.ms && clip?.verification && latestExport.operation === 'batch' && <p>{l('Son klip / duvar saati', 'Last clip / wall time')} · {(clip.verification.duration / (latestExport.ms / 1000)).toFixed(2)}×</p>}
      <ul>{recent?.map((row, i) => <li key={row.at + '-' + i}>{task(row.operation)} · {row.ms === undefined ? '—' : (row.ms / 1000).toFixed(2) + ' s'}</li>)}</ul>
      {analysisCache && <div className="shorts-actions">
        <p>{l('Yerel analiz önbelleği', 'Local analysis cache')} · {analysisCache.entries} · {(analysisCache.bytes / 1048576).toFixed(2)} MiB · {analysisCache.hits} {l('isabet', 'hits')}</p>
        <button className="export-cancel" disabled={!!budget.active || budget.waiting > 0 || !!activity?.job || !!activity?.batch.active}
          onClick={() => void bridge?.clear().catch(() => setError(true))}>{l('Analiz önbelleğini temizle', 'Clear analysis cache')}</button>
      </div>}
    </div>}
  </section>
}
