import { useState } from 'react'
import type { Copy, Language } from '../i18n'

export interface DiagnosticEntry { at: number; operation: string; outcome: string; ms?: number; code?: string }

const labels: Record<string, [string, string]> = {
  export: ['MP4 dışa aktarma', 'MP4 export'], sequence: ['Proje dışa aktarma', 'Project export'],
  transcribe: ['Otomatik altyazı', 'Transcription'], silence: ['Sessizlik analizi', 'Silence analysis'],
  'shorts-analysis': ['Shorts analizi', 'Shorts analysis'], batch: ['Shorts dışa aktarma', 'Shorts export'],
  proxy: ['Önizleme dosyası', 'Proxy preview'], waveform: ['Ses dalga formu', 'Audio waveform'],
  cleanup: ['Geçici dosya temizliği', 'Temporary cleanup'], renderer: ['Editör penceresi', 'Editor window'],
  cancelled: ['İptal edildi', 'Cancelled'], failed: ['Başarısız', 'Failed'], ready: ['Tamamlandı', 'Completed'],
}

export function Diagnostics({ language, copy }: { language: Language; copy: Copy }) {
  const [entries, setEntries] = useState<DiagnosticEntry[]>()
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)
  const tr = language === 'tr'
  const label = (key: string) => labels[key]?.[tr ? 0 : 1] ?? key
  async function refresh() {
    setError(false)
    try {
      const rows = (await window.viralCutDesktop?.diagnostics())?.entries
      if (!rows) throw new Error()
      setEntries(rows)
    } catch { setError(true) }
  }
  async function exportReport() {
    setSaved(false); setError(false)
    try {
      const result = await window.viralCutDesktop?.exportDiagnostics(language)
      if (result?.cancelled) return
      if (!result?.saved) throw Error()
      setSaved(true)
    } catch { setError(true) }
  }
  return <details className="panel diagnostics" onToggle={event => { if (event.currentTarget.open) void refresh() }}>
    <summary>{tr ? 'Yerel tanılama' : 'Local diagnostics'}</summary>
    <button type="button" className="export-cancel" onClick={() => void refresh()}>{tr ? 'Yenile' : 'Refresh'}</button>
    <button type="button" className="export-cancel" onClick={() => void exportReport()}>{tr ? 'Raporu dışa aktar' : 'Export report'}</button>
    {saved && <p role="status">{tr ? 'Rapor bilgisayarına kaydedildi.' : 'Report saved to your computer.'}</p>}
    {error && <p role="alert">{copy.exportErrors.serviceError}</p>}
    {entries?.length === 0 && <p>{tr ? 'Henüz işlem kaydı yok.' : 'No operations recorded yet.'}</p>}
    {!!entries?.length && <ol>{entries.map((entry, index) => <li key={index}>
      <time>{new Date(entry.at).toLocaleString(language)}</time> · {label(entry.operation)} · {label(entry.outcome)}
      {entry.ms !== undefined && ` · ${(entry.ms / 1000).toLocaleString(language, { maximumFractionDigits: 2 })} s`}
      {entry.code && <p>{Object.hasOwn(copy.exportErrors, entry.code) ? copy.exportErrors[entry.code as keyof Copy['exportErrors']] : entry.code}</p>}
    </li>)}</ol>}
  </details>
}
