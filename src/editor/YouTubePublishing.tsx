import { useEffect, useState } from 'react'
import type { Language } from '../i18n'
import type { Metadata, YouTubeChannel, YouTubeState } from './creatorMetadata'

export function YouTubePublishing({ language, filename, metadata }: { language: Language; filename?: string; metadata?: Metadata }) {
  const api = window.viralCutDesktop?.creator.youtube
  const l = (tr: string, en: string) => language === 'tr' ? tr : en
  const [channel, setChannel] = useState<YouTubeChannel>()
  const [upload, setUpload] = useState<YouTubeState>()
  const [privacy, setPrivacy] = useState('private')
  const [audience, setAudience] = useState('')
  const [altered, setAltered] = useState('')
  const [publishAt, setSchedule] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let closed = false
    async function read() {
      try { const value = await api?.status(); if (!closed) setUpload(value?.upload) } catch { /* Allow local exports while offline. */ }
    }
    void api?.account().then(value => { if (!closed) setChannel(value.channel) }).catch(() => {})
    void read()
    const poll = setInterval(read, 1200)
    return () => { closed = true; clearInterval(poll) }
  }, [api])

  async function action(name: 'connect' | 'disconnect' | 'start') {
    if (!api || working) return
    setWorking(true); setError('')
    try {
      if (name === 'connect') {
        const result = await api.connect()
        if (result.error) throw Error(result.error)
        if (result.channel) setChannel(result.channel)
      } else if (name === 'disconnect') {
        const result = await api.disconnect()
        if (result.error) throw Error(result.error)
        setChannel(undefined)
      } else if (channel && filename && metadata) {
        const result = await api.start({ ...metadata, filename, channel: channel.id, language, privacy,
          forKids: audience === 'yes', synthetic: altered === 'yes',
          publishAt: privacy === 'private' && publishAt ? new Date(publishAt).toISOString() : undefined })
        if (result.error) throw Error(result.error)
        if (result.started) setUpload({ phase: 'uploading', progress: 0 })
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'youtubeNetwork') }
    finally { setWorking(false) }
  }

  const phrases: Record<string, string> = {
    youtubeQuota: l('YouTube kota veya hız sınırına ulaştı.', 'YouTube quota or rate limit reached.'),
    youtubeCredentials: l('Google Cloud masaüstü OAuth JSON dosyası gerekli.', 'A Google Cloud Desktop OAuth JSON file is required.'),
    youtubePermission: l('Yetki reddedildi veya süresi doldu. Hesabı yeniden bağla.', 'Permission was denied or expired. Reconnect the account.'),
    youtubeStorage: l('Windows güvenli kimlik deposu kullanılamıyor.', 'Secure Windows credential storage is unavailable.'),
    youtubeSchedule: l('Planlı gönderi için özel görünürlük ve gelecekteki tarih gerekli.', 'Scheduling requires private visibility and a future date.'),
    youtubeChannel: l('Yetkili tek bir kanal doğrulanamadı.', 'Exactly one authorized channel could not be verified.'),
    youtubeNetwork: l('Google bağlantısı kesildi. Sonucu YouTube Studio’da kontrol et.', 'Google connection was interrupted. Check YouTube Studio.'),
    youtubeRejected: l('YouTube isteği reddetti.', 'YouTube rejected the request.'),
    busy: l('YouTube işlemi devam ediyor.', 'A YouTube operation is in progress.'),
  }
  return <section className="creator-calendar">
    <strong>YouTube Data API</strong>
    {channel ? <p>{channel.name} · {channel.id}</p> : <p>{l('Hesap bağlı değil. Kendi Google Cloud masaüstü OAuth JSON dosyanı seçebilirsin.',
      'No account connected. You can select your own Google Cloud Desktop OAuth JSON.')}</p>}
    <button className="export-cancel" disabled={working || upload?.phase === 'uploading'} onClick={() => void action(channel ? 'disconnect' : 'connect')}>
      {channel ? l('YouTube hesabını ayır', 'Disconnect YouTube') : l('YouTube hesabı bağla', 'Connect YouTube')}</button>
    {channel && filename && metadata && <fieldset className="creator-copy" disabled={working || upload?.phase === 'uploading'}>
      <legend>{filename}</legend>
      <p>{metadata.title}</p>
      <label>{l('Görünürlük', 'Visibility')}<select value={privacy} onChange={event => setPrivacy(event.target.value)}>
        <option value="private">{l('Özel', 'Private')}</option><option value="unlisted">{l('Liste dışı', 'Unlisted')}</option>
        <option value="public">{l('Herkese açık', 'Public')}</option></select></label>
      {privacy === 'private' && <label>{l('YouTube yayın tarihi (isteğe bağlı)', 'YouTube publish date (optional)')}
        <input type="datetime-local" value={publishAt} onChange={event => setSchedule(event.target.value)} /></label>}
      {[{ label: l('Çocuklara özel mi?', 'Made for kids?'), value: audience, update: setAudience },
        { label: l('Gerçekçi değiştirilmiş veya sentetik içerik var mı?', 'Contains realistic altered or synthetic content?'), value: altered, update: setAltered }].map(row =>
        <label key={row.label}>{row.label}<select value={row.value} onChange={event => row.update(event.target.value)}>
          <option value="">{l('Seç', 'Select')}</option><option value="yes">{l('Evet', 'Yes')}</option><option value="no">{l('Hayır', 'No')}</option>
        </select></label>)}
      <button className="export-cancel" disabled={!audience || !altered} onClick={() => void action('start')}>{l('Yükleme onayını aç', 'Review upload')}</button>
    </fieldset>}
    {(error || upload?.error) && <p role="alert">{phrases[error || upload?.error || ''] ?? l('YouTube isteği tamamlanamadı.', 'YouTube request did not finish.')}</p>}
    {upload && <div>
      <p>{({ uploading: l('YouTube’a yükleniyor', 'Uploading to YouTube'), uploaded: l('Yükleme alındı; durum bekleniyor', 'Upload acknowledged; status pending'),
        verified: l('Video kaydı doğrulandı', 'Video record verified'), cancelled: l('Yükleme iptal edildi', 'Upload cancelled'),
        failed: l('YouTube işlemi başarısız', 'YouTube operation failed') })[upload.phase]} · {upload.progress}%</p>
      {upload.id && <p>{upload.id} · {upload.processing} · {upload.visibility} {upload.publishAt}</p>}
      {upload.metrics && <p>{l('Görüntülenme', 'Views')} {upload.metrics.views ?? '—'} · {l('Beğeni', 'Likes')} {upload.metrics.likes ?? '—'} ·
        {' '}{l('Yorum', 'Comments')} {upload.metrics.comments ?? '—'}</p>}
      {upload.phase === 'uploading' && <button className="export-cancel" onClick={() => void api?.cancel()}>{l('Yüklemeyi iptal et', 'Cancel upload')}</button>}
    </div>}
  </section>
}
