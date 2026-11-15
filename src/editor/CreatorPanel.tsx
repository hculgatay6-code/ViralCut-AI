import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { Language } from '../i18n'
import { localExporter } from '../export/client'
import type { BatchResult } from '../export/client'
import { createDirectorPlan } from './directorPlan'
import type { PlannedShort } from './directorPlan'
import { finished } from './copilotRunner'
import type { Source } from './copilotRunner'
import { CoverStudio } from './CoverStudio'
import { YouTubePublishing } from './YouTubePublishing'
import { creatorStyles, platforms, suggestMetadata } from './creatorMetadata'
import type { CalendarEntry, CreatorStyle, Metadata, Platform, PlatformProfile } from './creatorMetadata'

type Clip = { row: PlannedShort; metadata: Metadata; suggestions: string[] }
const wait = () => new Promise<void>(resolve => setTimeout(resolve, 350))
export type CreatorIntent = { action: 'shorts' | 'titles' | 'cover' | 'calendar' | 'packages'; platform?: Platform; count?: number }

export function CreatorPanel({ visible, language, source, choose, intent }: {
  visible: boolean; language: Language; source?: Source; choose: () => Promise<boolean>; intent?: CreatorIntent
}) {
  const l = (tr: string, en: string) => language === 'tr' ? tr : en
  const bridge = window.viralCutDesktop?.creator
  const [profiles, setProfiles] = useState<PlatformProfile[]>([])
  const [presets, setPresets] = useState<Partial<Record<Platform, { bitrate: number; fps: number; max: number }>>>({})
  const [targets, setTargets] = useState<Platform[]>([...platforms])
  const [rows, setRows] = useState<Clip[]>([])
  const [selection, setSelection] = useState(0)
  const [count, setCount] = useState(1)
  const [goal, setGoal] = useState(30)
  const [style, setStyle] = useState<CreatorStyle>('professional')
  const [short, setShort] = useState('')
  const [progress, setProgress] = useState<number>()
  const [batch, setBatch] = useState<BatchResult>()
  const [error, setError] = useState('')
  const [cover, setCover] = useState(false)
  const [batchTargets, setBatchTargets] = useState<Platform[]>([])
  const [calendar, setCalendar] = useState<CalendarEntry[]>([])
  const [calendarTarget, setCalendarTarget] = useState<Platform>('youtube')
  const [filter, setFilter] = useState<'all' | Platform>('all')
  const [plannedAt, setDate] = useState('')
  const [calendarId, setCalendarId] = useState<string>()
  const [draft, setDraft] = useState<Metadata>()
  const operation = useRef<AbortController | undefined>(undefined)
  const ready = rows[selection]
  const used = draft ?? ready?.metadata
  const sourceId = source?.media.id
  const currentSource = useRef(sourceId)
  currentSource.current = sourceId
  const acceptIntent = useEffectEvent((intent: CreatorIntent) => {
    if (intent.platform) { setTargets([intent.platform]); setCalendarTarget(intent.platform) }
    if (intent.action === 'packages' && !intent.platform) setTargets([...platforms])
    if (intent.count) setCount(intent.count)
    if (intent.action === 'shorts' && intent.platform === 'tiktok') setGoal(15)
    if (intent.action === 'calendar') {
      if (!used) setDraft({ title: '', description: '', hashtags: [], keywords: [] })
      return
    }
    if (intent.action === 'cover' && ready) { setCover(true); return }
    if (source) void analyze(intent)
  })

  useEffect(() => {
    if (!visible || !bridge) return
    void bridge.profiles().then(setProfiles).catch(() => setError('profiles'))
    void bridge.calendar().then(value => setCalendar(value.rows ?? [])).catch(() => setError('calendar'))
  }, [visible, bridge])
  useEffect(() => {
    operation.current?.abort(); setRows([]); setBatch(undefined); setCover(false); setShort(''); setSelection(0)
  }, [sourceId])
  useEffect(() => {
    if (intent) acceptIntent(intent)
  }, [intent])

  function handleError(reason: unknown) {
    const value = reason instanceof Error ? reason.message : ''
    setError(value || 'saveFailed')
  }

  async function analyze(requested?: CreatorIntent) {
    if (!source || !bridge || operation.current) return
    const current = source
    const controller = new AbortController()
    operation.current = controller
    const { signal } = controller
    let jobId: string | undefined
    setProgress(0); setRows([]); setBatch(undefined); setCover(false); setError('')
    try {
      const length = requested?.action === 'shorts' && requested.platform === 'tiktok' ? 15 : goal
      const job = await localExporter.analyzeShorts(current.media.id, 'auto', -38, .65, length, current.duration, style === 'gaming' ? 'gaming' : 'general', 'auto', true)
      jobId = job.id
      await finished(job, signal, setProgress)
      const report = await localExporter.shortsAnalysis(job.id, signal)
      signal.throwIfAborted()
      const plan = createDirectorPlan(report, requested?.count ?? count, style === 'gaming' ? 'gaming' : 'auto')
      if (!plan.length) throw Error('noCandidates')
      setShort(suggestMetadata(report.cues, plan[0].item, plan[0].clip.visual?.objects ?? [], language, style).short)
      setRows(plan.map(row => {
        const suggestions = suggestMetadata(report.cues, row.item, row.clip.visual?.objects ?? [], language, style)
        return { row, metadata: suggestions, suggestions: suggestions.titles }
      }))
      setSelection(0)
      if (requested?.action === 'cover') setCover(true)
    } catch (reason) { handleError(signal.aborted ? Error('cancelled') : reason) }
    finally { if (jobId) await localExporter.release(jobId); operation.current = undefined; setProgress(undefined) }
  }

  function refreshCopy() {
    if (!ready) return
    const result = suggestMetadata(ready.row.item.overlay?.cues ?? [], ready.row.item, ready.row.clip.visual?.objects ?? [], language, style)
    setShort(result.short)
    setRows(previous => previous.map((clip, index) => selection === index ?
      { ...clip, suggestions: result.titles, metadata: result } : clip))
  }

  async function renderPackages() {
    if (!source || !bridge || !rows.length || !targets.length || operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setProgress(0); setError(''); setBatch(undefined); setBatchTargets(targets)
    try {
      const items = rows.flatMap(({ row, metadata }) => targets.map(platform => {
        const profile = profiles.find(item => item.id === platform)!
        return { ...row.item, platform, metadata, preset: presets[platform] ?? { bitrate: profile.bitrate, fps: profile.fps, max: profile.max } }
      }))
      let state = await bridge.start({ mediaId: source.media.id, language, items })
      if (state.error) throw Error(state.error)
      if (state.cancelled) return
      if (controller.signal.aborted || currentSource.current !== source.media.id) await bridge.cancel()
      while (state.active) {
        setBatch(state)
        setProgress(state.items.reduce((sum, item) => sum + item.progress, 0) / state.items.length)
        await wait()
        state = await bridge.status()
      }
      if (currentSource.current === source.media.id) setBatch(state)
    } catch (reason) { handleError(reason) }
    finally { operation.current = undefined; setProgress(undefined) }
  }

  async function saveDate() {
    if (!bridge || !used) return
    setError('')
    const platform = calendarTarget
    const targetIndex = batchTargets.indexOf(platform)
    const output = !draft && targetIndex >= 0 ? batch?.items[selection * batchTargets.length + targetIndex] : undefined
    try {
      const result = await bridge.save({ ...used, id: calendarId, platform, plannedAt: plannedAt ? new Date(plannedAt).toISOString() : '',
        output: output?.platform === platform && output.phase === 'ready' ? output.filename : undefined })
      if (result.error || !result.row) throw Error(result.error ?? 'calendar')
      setCalendar(previous => [...previous.filter(entry => entry.id !== result.row!.id), result.row!])
      setDraft(undefined); setCalendarId(undefined); setDate('')
    } catch (reason) { handleError(reason) }
  }

  const errors: Record<string, string> = {
    badMetadata: l('Başlık, açıklama veya hashtag platform sınırına uymuyor.', 'The title, caption or hashtags exceed the platform rules.'),
    noCandidates: l('Uygun 15–60 saniyelik aday bulunamadı.', 'No suitable 15–60 second candidate was found.'),
    busy: l('Başka bir video işi çalışıyor. Tamamlanınca tekrar dene.', 'Another video job is running. Retry when it finishes.'),
    cancelled: l('İşlem iptal edildi.', 'Operation cancelled.'),
    badRange: l('Klip süresi profile uymuyor.', 'The clip duration exceeds the profile.'),
  }
  const busy = progress !== undefined
  const draftEdit = (value: Partial<Metadata>) => {
    if (draft) setDraft({ ...draft, ...value })
    else setRows(previous => previous.map((row, index) => index === selection ? { ...row, metadata: { ...row.metadata, ...value } } : row))
  }
  const display = batch?.items.slice(selection * batchTargets.length, (selection + 1) * batchTargets.length) ?? []
  return <section className="panel creator-panel" hidden={!visible} aria-label={l('Yayın Stüdyosu', 'Publishing Studio')}>
    <header className="panel-header"><h2>{l('Yayın Stüdyosu', 'Publishing Studio')}</h2></header>
    <div className="auto-shorts-body">
      <button className="export-cancel" disabled={busy} onClick={() => { void choose() }}>{l('Kaynak video seç', 'Choose source video')}</button>
      {source && <p>{source.media.name}</p>}
      <fieldset className="auto-settings" disabled={busy}>
        <label>{l('Klip sayısı', 'Clips')}<select value={count} onChange={event => setCount(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></label>
        <label>{l('Hedef süre', 'Target length')}<select value={goal} onChange={event => setGoal(Number(event.target.value))}>{[15, 30, 60].map(n => <option key={n} value={n}>{n} s</option>)}</select></label>
        <label>{l('Başlık stili', 'Title style')}<select value={style} onChange={event => setStyle(event.target.value as CreatorStyle)}>
          {creatorStyles.map((value, i) => <option key={value} value={value}>{(language === 'tr' ? ['Profesyonel', 'Merak', 'Eğlence', 'Eğitim', 'Oyun', 'Minimal'] :
            ['Professional', 'Curious', 'Fun', 'Education', 'Gaming', 'Minimal'])[i]}</option>)}</select></label>
      </fieldset>
      <button className="primary" disabled={!source || busy} onClick={() => void analyze()}>{l('Videoyu analiz et ve klip seç', 'Analyze video and select clips')}</button>
      {intent && !rows.length && <p>{l('Copilot isteği alındı. Analizi başlatarak adayları incele.', 'Copilot request received. Run analysis to review candidates.')}</p>}
      {busy && <div className="shorts-actions"><progress value={progress} max={100} aria-label={l('İlerleme', 'Progress')} />
        <button className="export-cancel" onClick={() => { operation.current?.abort(); if (batch?.active) void bridge?.cancel() }}>{l('İptal et', 'Cancel')}</button></div>}
      {error && <p role="alert">{errors[error] ?? l('Yerel işlem tamamlanamadı. Dosyayı ve ayarları kontrol et.', 'Local work did not finish. Check the file and settings.') + ' (' + error + ')'}</p>}
      {!!rows.length && <label>{l('Klip', 'Clip')}<select disabled={busy} value={selection} onChange={event => {
        setSelection(Number(event.target.value)); setShort(''); setCover(false); setDraft(undefined); setCalendarId(undefined)
      }}>{rows.map(({ row }, i) => <option key={row.clip.id} value={i}>{i + 1} · {row.item.start.toFixed(1)}–{row.item.end.toFixed(1)} s</option>)}</select></label>}
      {ready && !draft && <div className="shorts-actions">
        <button className="export-cancel" disabled={busy} onClick={refreshCopy}>{l('Bu dilde metin öner', 'Suggest copy in this language')}</button>
        <button className="export-cancel" disabled={busy} onClick={() => setCover(!cover)}>{l('Kapak düzenle', 'Edit cover')}</button>
      </div>}
      {short && <p>{short}</p>}
      {used && <div className="creator-copy">
        {ready && !draft && <label>{l('Başlık önerileri', 'Title suggestions')}<select aria-label={l('Başlık önerileri', 'Title suggestions')} disabled={busy} value="" onChange={event => draftEdit({ title: event.target.value })}>
          <option value="">{l('Bir başlık seç', 'Choose a title')}</option>{ready.suggestions.map(title => <option key={title}>{title}</option>)}
        </select></label>}
        <label>{l('Başlık', 'Title')}<input disabled={busy} maxLength={100} value={used.title} onChange={event => draftEdit({ title: event.target.value })} /></label>
        <label>{l('Açıklama', 'Description')}<textarea disabled={busy} maxLength={5000} value={used.description} onChange={event => draftEdit({ description: event.target.value })} /></label>
        <label>{l('Hashtagler', 'Hashtags')}<input disabled={busy} key={used.hashtags.join(' ')} defaultValue={used.hashtags.join(' ')}
          onBlur={event => draftEdit({ hashtags: event.target.value.trim().split(/\s+/).filter(Boolean).slice(0, 12) })} /></label>
        {!!used.keywords.length && <p>{l('Anahtar kelimeler', 'Keywords')} · {used.keywords.join(', ')}</p>}
      </div>}
      {visible && cover && source && ready && <CoverStudio key={selection} language={language} source={'/project-media/' + source.media.id}
        range={ready.row.item} cues={ready.row.item.overlay?.cues ?? []} initialTitle={ready.metadata.title} />}
      <div className="creator-targets">{profiles.map(profile => <label key={profile.id}>
        <input type="checkbox" disabled={busy} checked={targets.includes(profile.id)} onChange={event => setTargets(current =>
          event.target.checked ? platforms.filter(id => id === profile.id || current.includes(id)) : current.filter(id => id !== profile.id))} />
        {profile.name}<span>1080 × 1920 · {presets[profile.id]?.fps ?? profile.fps} fps · {((presets[profile.id]?.bitrate ?? profile.bitrate) / 1000).toFixed(1)} Mb/s</span>
      </label>)}</div>
      <details><summary>{l('Dışa aktarma profillerini düzenle', 'Edit export profiles')}</summary>
        {profiles.map(profile => {
          const value = presets[profile.id] ?? { fps: profile.fps, bitrate: profile.bitrate, max: profile.max }
          return <fieldset key={profile.id} disabled={busy}><legend>{profile.name}</legend>
            <label>FPS<select value={value.fps} onChange={event => setPresets(previous => ({ ...previous, [profile.id]: { ...value, fps: Number(event.target.value) } }))}>
              {[24, 25, 30, 50, 60].map(fps => <option key={fps}>{fps}</option>)}</select></label>
            <label>{l('Video bit hızı', 'Video bitrate')} (kb/s)<input aria-label={profile.name + ' bitrate'} type="number" min={2500} max={12000} step={100}
              value={value.bitrate} onChange={event => setPresets(previous => ({ ...previous, [profile.id]: { ...value, bitrate: Number(event.target.value) } }))} /></label>
            <label>{l('Süre sınırı (sn)', 'Duration cap (s)')}<input type="number" min={15} max={profile.max} value={value.max}
              onChange={event => setPresets(previous => ({ ...previous, [profile.id]: { ...value, max: Number(event.target.value) } }))} /></label>
          </fieldset>
        })}
      </details>
      <button className="primary" disabled={busy || !rows.length || !targets.length || profiles.length !== 3} onClick={() => void renderPackages()}>
        {l('MP4 ve metadata paketlerini hazırla', 'Prepare MP4 and metadata packages')}</button>
      {!!display.length && <div className="creator-compare">{display.map((item, index) => <article key={index}>
        <strong>{profiles.find(profile => profile.id === (item.platform ?? batchTargets[index]))?.name}</strong>
        <p>{item.phase === 'ready' ? l('Yerel çıktı doğrulandı', 'Local output verified') : item.phase === 'failed' ? l('Başarısız', 'Failed') :
          item.phase === 'cancelled' ? l('İptal edildi', 'Cancelled') : Math.round(item.progress) + '%'}</p>
        {item.error && <p>{errors[item.error] ?? item.error}</p>}
        {visible && item.filename && item.phase === 'ready' && <video controls preload="none" src={'/creator-render/' + item.filename} />}
      </article>)}</div>}
      {batch?.items.some(item => item.phase === 'ready') && <button className="export-cancel" onClick={() => void bridge?.reveal()}>{l('Paket klasörünü aç', 'Open package folder')}</button>}
      <details><summary>{l('Hesaplar ve yayınlama', 'Accounts and publishing')}</summary>
        {visible && <YouTubePublishing language={language} metadata={ready?.metadata}
          filename={display.find(item => item.platform === 'youtube' && item.phase === 'ready')?.filename} />}
        {profiles.filter(profile => profile.id !== 'youtube').map(profile => <p key={profile.id}>{profile.name} · {l('Yerel paket hazırlandığında MP4 ve metadata ile manuel yükle.',
          'Once the local package is ready, upload the MP4 and metadata manually.')}</p>)}
        <p>{l('Sosyal medya ölçümleri için yetkili hesap ve API erişimi gerekiyor.', 'Social metrics require an authorized account and API access.')}</p>
      </details>
      <div className="creator-calendar">
        <h3>{l('Yerel içerik takvimi', 'Local content calendar')}</h3>
        <p>{l('Tarihler planlama içindir. Uygulama kapalıyken yükleme veya yayın başlatılmaz.', 'Dates are planning reminders. Closing the app does not schedule an upload or publication.')}</p>
        {!used && <button className="export-cancel" onClick={() => setDraft({ title: '', description: '', hashtags: [], keywords: [] })}>{l('Yeni taslak', 'New draft')}</button>}
        {used && <div className="auto-settings">
          <label>{l('Takvim platformu', 'Calendar platform')}<select value={calendarTarget} onChange={event => setCalendarTarget(event.target.value as Platform)}>
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
          <label>{l('Planlanan tarih', 'Planned date')}<input type="datetime-local" value={plannedAt} onChange={event => setDate(event.target.value)} /></label>
          <button className="export-cancel" disabled={busy || !used.title.trim()} onClick={() => void saveDate()}>{l('Takvime kaydet', 'Save to calendar')}</button>
        </div>}
        <label>{l('Platform filtresi', 'Platform filter')}<select value={filter} onChange={event => setFilter(event.target.value as Platform | 'all')}>
          <option value="all">{l('Tümü', 'All')}</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        {[...calendar].filter(item => filter === 'all' || item.platform === filter).sort((a, b) =>
          (a.plannedAt || '9999').localeCompare(b.plannedAt || '9999')).map(item => <article key={item.id}>
          <strong>{item.title}</strong><p>{profiles.find(profile => profile.id === item.platform)?.name} · {item.filename ?? l('Taslak', 'Draft')} ·
            {item.plannedAt ? ' ' + new Date(item.plannedAt).toLocaleString() : ' ' + l('Tarih yok', 'No date')}</p>
          <button className="export-cancel" onClick={() => {
            setCalendarId(item.id); setDraft(item); setCalendarTarget(item.platform)
            const date = item.plannedAt && new Date(item.plannedAt)
            setDate(date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
          }}>{l('Taslağı düzenle', 'Edit draft')}</button></article>)}
      </div>
    </div>
  </section>
}
