import { useState } from 'react'
import type { Language } from '../i18n'

export type BetaPreferences = { interval: number; repository: string; language: Language }
export type ReleaseCheck = { state: 'unconfigured' | 'unavailable' | 'limited' | 'error' | 'offline' | 'current' | 'available'; tag?: string; notes?: string }

export function BetaSettings({ language, settings, update, version }: {
  language: Language; settings: BetaPreferences; update: (settings: BetaPreferences) => void; version: string
}) {
  const tr = language === 'tr'
  const l = (value: string, en: string) => tr ? value : en
  const [draft, setDraft] = useState(settings.repository)
  const [interval, setInterval] = useState(settings.interval)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<ReleaseCheck>()
  const api = window.viralCutDesktop?.beta
  async function save() {
    setBusy(true); setMessage(''); setResult(undefined)
    try {
      const response = await api?.save({ interval, repository: draft.trim(), language })
      if (!response?.settings) throw Error()
      update(response.settings)
      setMessage(l('Ayarlar kaydedildi.', 'Settings saved.'))
    } catch { setMessage(l('Ayarlar kaydedilemedi. Depoyu sahip/depo biçiminde yaz.', 'Could not save settings. Use owner/repository.')) }
    finally { setBusy(false) }
  }
  async function check() {
    setBusy(true); setMessage('')
    try { setResult(await api?.check() ?? { state: 'error' }) }
    catch { setResult({ state: 'error' }) }
    finally { setBusy(false) }
  }
  const descriptions: Record<ReleaseCheck['state'], string> = {
    unconfigured: l('Önce GitHub deposunu ayarla.', 'Set a GitHub repository first.'),
    unavailable: l('Depo veya sürüm listesi erişime kapalı. GitHub’da hesabınla açmayı dene.', 'The repository or release list is inaccessible. Try opening it in GitHub while signed in.'),
    offline: l('GitHub’a ulaşılamadı. Düzenlemeye devam edebilirsin.', 'GitHub could not be reached. You can keep editing.'),
    limited: l('GitHub istek sınırı veya erişim engeli. Daha sonra tekrar dene.', 'GitHub rate limit or access restriction. Retry later.'),
    error: l('Sürüm bilgisi okunamadı.', 'Could not read release information.'),
    current: l('Erişilebilen sürümler arasında daha yeni bir sürüm yok.', 'No newer release was found among accessible releases.'),
    available: l('Yeni sürüm', 'Update available'),
  }
  return <section className="panel beta-settings" aria-label={l('Ayarlar ve Hakkında', 'Settings and About')}>
    <header className="panel-header"><h2>{l('Ayarlar ve Hakkında', 'Settings and About')}</h2></header>
    <div className="auto-shorts-body">
      <p><strong>ViralCut AI</strong> · {version}</p>
      <label>{l('Otomatik kayıt aralığı', 'Autosave interval')}<select value={interval} onChange={e => setInterval(Number(e.target.value))}>
        <option value={0}>{l('Kapalı', 'Off')}</option>
        {[5, 15, 30, 60].map(value => <option key={value} value={value}>{value} {l('saniye', 'seconds')}</option>)}
      </select></label>
      <label>{l('GitHub deposu', 'GitHub repository')}<input value={draft} onChange={e => setDraft(e.target.value)} maxLength={140} placeholder="sahip/depo" /></label>
      <p>{l('GitHub bağlantıları için depo adını gir. Güncelleme kontrolü yalnızca düğmeye bastığında çalışır.', 'Enter the repository for GitHub links. Update checks run on request.')}</p>
      <div className="shorts-actions">
        <button className="export-cancel" disabled={busy} onClick={() => void save()}>{l('Ayarları kaydet', 'Save settings')}</button>
        <button className="primary" disabled={busy} onClick={() => void check()}>{l('Güncellemeleri kontrol et', 'Check for updates')}</button>
      </div>
      {message && <p role="status">{message}</p>}
      {result && <div role="status"><p>{descriptions[result.state]} {result.tag}</p>
        {!!result.notes && <pre className="beta-notes">{result.notes}</pre>}</div>}
      <div className="shorts-actions">
        {(['repository', 'issues', 'releases'] as const).map(target => <button className="export-cancel" key={target} disabled={!settings.repository}
          onClick={() => void api?.open(target).then(value => {
            if (!value.opened) setMessage(l('GitHub bağlantısı açılamadı.', 'Could not open GitHub.'))
          }).catch(() => setMessage(l('GitHub bağlantısı açılamadı.', 'Could not open GitHub.')))}>
          {{ repository: 'GitHub', issues: l('GitHub Issues ile geri bildirim', 'Feedback on GitHub Issues'), releases: l('Sürüm sayfasını aç', 'Open releases') }[target]}
        </button>)}
      </div>
      <p>{l('Lisanslar: Electron ve Whisper.cpp MIT, paketlenmiş FFmpeg GPL-3.0. Üçüncü taraf bildirimleri kurulumun resources/licenses klasöründe.', 'Licenses: Electron and Whisper.cpp MIT, bundled FFmpeg GPL-3.0. Third-party notices are in resources/licenses.')}</p>
    </div>
  </section>
}
