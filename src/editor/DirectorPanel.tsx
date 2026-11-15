import { useEffect, useRef, useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { ExportClientError, localExporter } from '../export/client'
import type { BatchResult, ExportJob, ShortsAnalysis } from '../export/client'
import type { Copy, Language } from '../i18n'
import type { Project, ProjectMedia } from '../project/model'
import { defaultAppearance } from '../subtitles/model'
import type { Appearance, Cue } from '../subtitles/model'
import { createDirectorPlan, profiles } from './directorPlan'
import type { DirectorProfile, PlannedShort } from './directorPlan'
import type { StudioEffects } from './effects'
import { editedDuration } from './autoShorts'
import { timecode } from './model'
import type { ClipRange } from './model'
import type { Frame } from './shorts'
import { captionStyles, colorStyles, intensities, studioDefaults } from './cinematic'
import type { StudioSettings } from './cinematic'

const phases = ['prepare', 'silence', 'speech', 'vision', 'media', 'ranking', 'plan', 'render', 'quality'] as const
type Phase = typeof phases[number]
type State = 'idle' | 'running' | 'ready' | 'failed' | 'cancelled'
const nextPoll = () => new Promise<void>(resolve => setTimeout(resolve, 400))

export function DirectorPanel({ language, copy, source, open, preview, load }: {
  language: Language; copy: Copy; source?: { media: ProjectMedia; duration: number }
  open(media: ProjectMedia): void
  preview(range: ClipRange, cues: Cue[], appearance: Appearance, frame: Frame, remove: ClipRange[], effects?: StudioEffects): void
  load(project: Project): void
}) {
  const tr = language === 'tr'
  const l = (turkish: string, english: string) => tr ? turkish : english
  const bridge = window.viralCutDesktop
  const [automatic, setAutomatic] = useState(true)
  const [goal, setGoal] = useState(0)
  const [count, setCount] = useState(3)
  const [resolution, setResolution] = useState<720 | 1080>(1080)
  const [profile, setProfile] = useState<DirectorProfile>('auto')
  const [settings, setSettings] = useState(studioDefaults)
  const [music, setMusic] = useState('')
  const [rendered, setRendered] = useState('')
  const update = <K extends keyof StudioSettings,>(key: K, value: StudioSettings[K]) => setSettings(previous => ({ ...previous, [key]: value }))
  const [phase, setPhase] = useState<Phase>('prepare')
  const [state, setState] = useState<State>('idle')
  const [progress, setProgress] = useState(0)
  const [waiting, setWaiting] = useState(false)
  const [cacheHit, setCacheHit] = useState(false)
  const [analysis, setAnalysis] = useState<ShortsAnalysis>()
  const [plan, setPlan] = useState<PlannedShort[]>([])
  const [batch, setBatch] = useState<BatchResult>()
  const [projectFiles, setProjectFiles] = useState<string[]>([])
  const [folder, setFolder] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const operation = useRef<{ controller: AbortController; job?: string; rendering?: boolean }>(null)
  const busy = state === 'running'
  const analysisMs = useRef(0)
  const selected = plan.filter(row => row.selected)
  const valid = selected.every(row => editedDuration(row.item, row.item.remove) >= 14.999 &&
    row.item.end - row.item.start <= 60.001 && row.item.start >= 0 && row.item.end <= (analysis?.duration ?? source?.duration ?? 0) + .001)

  function trim(index: number, bound: 'start' | 'end', seconds: number) {
    if (!Number.isFinite(seconds) || !analysis) return
    setPlan(current => current.map((row, i) => {
      if (i !== index) return row
      const { item } = row
      const start = bound === 'start' ? seconds : item.start
      const end = bound === 'end' ? seconds : item.end
      if (start < 0 || end > (analysis.duration ?? source?.duration ?? 0) + .001 || end <= start) return row
      const remove = item.remove.filter(span => span.start > start + .24 && span.end < end - .24)
      const cues = analysis.cues.filter(cue => cue.start < end && cue.end > start)
      return { ...row, item: { ...item, start, end, remove, frame: { ...item.frame, track: undefined },
        effects: { ...item.effects, zoom: undefined, zoomReturn: undefined }, overlay: item.overlay && cues.length ? { ...item.overlay, cues } : undefined } }
    }))
  }

  useEffect(() => {
    const active = operation.current
    active?.controller.abort()
    if (active?.job) void localExporter.release(active.job)
    if (active?.rendering) void bridge?.director.cancel().catch(() => {})
    setState('idle'); setAnalysis(undefined); setPlan([]); setBatch(undefined); setProjectFiles([]); setFolder(''); setError(''); setRendered('')
  }, [source?.media.id, bridge])

  async function choose() {
    if (!bridge || busy) return
    try {
      const result = await bridge.shorts.chooseSource(language)
      if (result.media) open(result.media)
      else if (result.error) setError(copy.decode)
    } catch { setError(copy.decode) }
  }

  async function exportPlan(rows: PlannedShort[], signal: AbortSignal, started: number) {
    if (!source || !bridge) return
    setPhase('render')
    const result = await bridge.director.start({ mediaId: source.media.id, language, resolution, encoder: 'auto',
      items: rows.filter(row => row.selected).map(row => row.item), useMusic: !!music })
    if (result.folder) setFolder(result.folder)
    if (result.projectFiles) setProjectFiles(result.projectFiles)
    if (result.error) throw new ExportClientError(result.error)
    if (operation.current) operation.current.rendering = true
    setBatch(result)
    if (signal.aborted) await bridge.director.cancel()
    let current: BatchResult = await bridge.director.status()
    setBatch(current)
    while (current.active) {
      await nextPoll()
      current = await bridge.director.status()
      setBatch(current)
      setWaiting(!!current.waiting)
      if (current.items.some(item => item.phase === 'processing' && item.progress >= 95)) setPhase('quality')
      else if (current.active) setPhase('render')
      setProgress(current.items.reduce((sum, item) => sum + (item.phase === 'queued' || item.phase === 'processing' ? item.progress : 100), 0) / rows.filter(row => row.selected).length)
    }
    setPhase(current.items.some(item => item.phase === 'ready' || item.progress >= 95) ? 'quality' : 'render')
    setElapsed(analysisMs.current + performance.now() - started)
    setState(signal.aborted ? 'cancelled' : current.items.some(item => item.phase === 'failed') ? 'failed' : 'ready')
  }

  async function run(exportOnly = false) {
    if (!source || !bridge || operation.current || (exportOnly && (!selected.length || !valid))) return
    const active = { controller: new AbortController(), job: undefined as string | undefined }
    operation.current = active
    const signal = active.controller.signal
    const begin = performance.now()
    setError(''); setProgress(0); setWaiting(false); setState('running'); setBatch(undefined); setProjectFiles([]); setFolder(''); setRendered('')
    setPhase(exportOnly ? 'plan' : 'prepare')
    try {
      if (exportOnly || automatic) {
        const destination = await bridge.director.folder(language)
        signal.throwIfAborted()
        if (destination.cancelled) { setState(exportOnly ? 'ready' : 'idle'); return }
        if (destination.error) throw new ExportClientError(destination.error)
      }
      if (exportOnly) {
        await exportPlan(plan.map(row => ({ ...row, item: { ...row.item, mastering: settings.target === null ? undefined :
          { target: settings.target, musicLevel: settings.musicLevel } } })), signal, performance.now())
        return
      }
      setAnalysis(undefined); setPlan([]); setCacheHit(false)
      const job = await localExporter.analyzeShorts(source.media.id, 'auto', -38, .65, goal, source.duration,
        profile === 'gaming' ? 'gaming' : 'general', 'auto', true)
      active.job = job.id
      let status: ExportJob = job
      while (status.phase !== 'ready' && status.phase !== 'failed') {
        signal.throwIfAborted()
        if (status.stage) setPhase(status.stage)
        setWaiting(!!status.waiting)
        setProgress(status.progress)
        await nextPoll()
        status = await localExporter.status(job.id, signal)
      }
      if (status.phase === 'failed') throw new ExportClientError(status.error ?? 'serviceError')
      setWaiting(false); setCacheHit(!!status.cacheHit)
      const result = await localExporter.shortsAnalysis(job.id, signal)
      await localExporter.release(job.id)
      active.job = undefined
      signal.throwIfAborted()
      setPhase('plan')
      const rows = createDirectorPlan(result, count, profile, settings)
      setAnalysis(result); setPlan(rows); setProgress(100)
      analysisMs.current = performance.now() - begin
      setElapsed(analysisMs.current)
      if (automatic && rows.length) await exportPlan(rows, signal, performance.now())
      else setState('ready')
    } catch (reason) {
      setState(signal.aborted ? 'cancelled' : 'failed')
      if (!signal.aborted) setError(copy.exportErrors[reason instanceof ExportClientError ? reason.code : 'serviceError'] ?? copy.exportErrors.serviceError)
    } finally {
      if (active.job) await localExporter.release(active.job)
      if (operation.current === active) operation.current = null
    }
  }

  function cancel() {
    operation.current?.controller.abort()
    if (operation.current?.rendering) void bridge?.director.cancel().catch(() => {})
  }

  const names = [l('Hazırlık', 'Preparation'), ...(['silence', 'speech', 'vision', 'media', 'ranking'] as const).map(key => copy.analysisStages[key]),
    l('Kurgu ve altyazı planı', 'Edit and caption plan'), l('MP4 ve düzenlenebilir proje', 'MP4 and editable project'), l('Çıktı doğrulama', 'Output verification')]
  const styleNames = tr ? ['Otomatik', 'Oyun', 'Podcast', 'Konuşma', 'Eğitim', 'Eğlence', 'Vlog', 'Genel']
    : ['Automatic', 'Gaming', 'Podcast', 'Speech', 'Education', 'Entertainment', 'Vlog', 'General']
  const indexOfPhase = phases.indexOf(phase)
  const showReport = !!analysis && !busy
  return <section className="panel director-panel" aria-label={l('AI Otonom Editör', 'AI Director')}>
    <header className="panel-header"><h2><Clapperboard size={15} />{l('Profesyonel AI Stüdyo', 'Professional AI Studio')}</h2></header>
    <div className="auto-shorts-body">
      <button className="export-cancel" disabled={busy} onClick={() => void choose()}>{l('Yönetmen için video seç', 'Choose video for Director')}</button>
      {source && <p>{source.media.name} · {timecode(source.duration)}</p>}
      <div className="auto-settings">
        <label>{l('Düzenleme modu', 'Editing mode')}<select disabled={busy} value={automatic ? 'auto' : 'review'} onChange={e => setAutomatic(e.target.value === 'auto')}>
          <option value="auto">{l('Tam otomatik', 'Fully automatic')}</option><option value="review">{l('Manuel onay', 'Manual approval')}</option></select></label>
        <label>{copy.semanticGoal}<select disabled={busy} value={goal} onChange={e => setGoal(Number(e.target.value))}>
          <option value={0}>{l('Otomatik uzunluk', 'Automatic length')}</option>{[15, 30, 60].map(value => <option value={value} key={value}>{value} {copy.seconds}</option>)}</select></label>
        <label>{l('Çıktı sayısı', 'Output count')}<select disabled={busy} value={count} onChange={e => setCount(Number(e.target.value))}>
          <option value={0}>{l('AI karar versin', 'Let AI decide')}</option>{[1, 3, 5, 10].map(value => <option value={value} key={value}>{value}</option>)}</select></label>
        <label>{copy.resolution}<select disabled={busy} value={resolution} onChange={e => setResolution(Number(e.target.value) as 720 | 1080)}>
          <option value={1080}>1080 × 1920</option><option value={720}>720 × 1280</option></select></label>
        <label>{l('İçerik stili', 'Content style')}<select disabled={busy} value={profile} onChange={e => setProfile(e.target.value as DirectorProfile)}>
          {profiles.map((value, index) => <option value={value} key={value}>{styleNames[index]}</option>)}</select></label>
      </div>
      <details className="auto-preferences">
        <summary>{l('Kamera, altyazı, renk ve ses', 'Camera, captions, color and audio')}</summary>
        <fieldset disabled={busy} className="auto-settings">
          <label>{l('Kamera', 'Camera')}<select value={settings.camera} onChange={e => update('camera', e.target.value as StudioSettings['camera'])}>
            <option value="auto">{l('Otomatik takip', 'Auto tracking')}</option><option value="center">{l('Sabit merkez', 'Fixed center')}</option>
            <option value="contain">{l('Tüm kareyi koru', 'Keep full frame')}</option></select></label>
          <label>{l('Altyazı stili', 'Caption style')}<select value={settings.captions} onChange={e => update('captions', e.target.value as StudioSettings['captions'])}>
            {captionStyles.map((value, i) => <option value={value} key={value}>{(tr ? ['Otomatik', 'Minimal', 'Oyun', 'Podcast', 'Dinamik', 'Sinematik', 'Sade profesyonel'] :
              ['Automatic', 'Minimal', 'Gaming', 'Podcast', 'Dynamic', 'Cinematic', 'Clean professional'])[i]}</option>)}</select></label>
          <label>{l('Renk profili', 'Color profile')}<select value={settings.color} onChange={e => update('color', e.target.value as StudioSettings['color'])}>
            {colorStyles.map((value, i) => <option value={value} key={value}>{(tr ? ['Otomatik', 'Doğal', 'Canlı', 'Sinematik', 'Oyun'] :
              ['Automatic', 'Natural', 'Vivid', 'Cinematic', 'Gaming'])[i]}</option>)}</select></label>
          <label>{l('Efekt yoğunluğu', 'Effect intensity')}<select value={settings.intensity} onChange={e => update('intensity', e.target.value as StudioSettings['intensity'])}>
            {intensities.map((value, i) => <option value={value} key={value}>{(tr ? ['Kapalı', 'Düşük', 'Dengeli', 'Yüksek'] : ['Off', 'Low', 'Balanced', 'High'])[i]}</option>)}</select></label>
          <label>{l('Ses yüksekliği hedefi', 'Loudness target')}<select value={settings.target ?? 'off'} onChange={e => update('target', e.target.value === 'off' ? null : Number(e.target.value))}>
            <option value="off">{l('Kapalı', 'Off')}</option>{[-24, -20, -18, -16, -14].map(value => <option value={value} key={value}>{value} LUFS</option>)}</select></label>
          <label><input type="checkbox" checked={settings.noise} onChange={e => update('noise', e.target.checked)} />{l('Hafif gürültü azaltma', 'Light noise reduction')}</label>
          <label>{l('Arka plan müziği', 'Background music')}<button className="export-cancel" disabled={settings.target === null} onClick={() =>
            void bridge?.director.music(language).then(result => { if (result.name) setMusic(result.name); else if (result.error) setError(copy.decode) }).catch(() => setError(copy.decode))}>
            {l('Yerel müzik seç', 'Choose local music')}</button></label>
          {music && <><p>{music}</p><button className="export-cancel" onClick={() => setMusic('')}>{copy.close}</button>
            <label>{l('Müzik seviyesi', 'Music level')}<input type="range" min=".01" max=".35" step=".01" value={settings.musicLevel}
              onChange={e => update('musicLevel', e.target.valueAsNumber)} /></label></>}
        </fieldset>
      </details>
      <div className="shorts-actions"><button className="primary" disabled={busy || !source?.duration} onClick={() => void run()}>{l('AI ile Otomatik Düzenle', 'Edit Automatically with AI')}</button>
        {busy && <button className="export-cancel" onClick={cancel}>{copy.exportCancel}</button>}</div>
      {state !== 'idle' && <ol className="director-stages" aria-label={l('Analiz aşamaları', 'Analysis stages')}>
        {names.map((name, index) => <li key={phases[index]} data-active={index === indexOfPhase && busy}>
          <span>{name}</span><strong>{index < indexOfPhase || (index === indexOfPhase && state === 'ready') ? l('Tamamlandı', 'Done') :
            index === indexOfPhase ? busy ? l('Çalışıyor', 'Running') : state === 'failed' ? l('Başarısız', 'Failed') : l('İptal edildi', 'Cancelled') : l('Bekliyor', 'Waiting')}</strong>
        </li>)}
      </ol>}
      {busy && <progress max={100} value={progress} aria-label={copy.exportProgress} />}
      {busy && waiting && <p role="status">{l('Kullanılabilir bellek bekleniyor. İşlemi iptal edebilirsin.', 'Waiting for available memory. You can cancel this job.')}</p>}
      {error && <p role="alert">{error}</p>}
      {showReport && <div className="director-report">
        <h3>{l('Düzenleme raporu', 'Editing report')}</h3>
        {cacheHit && <p>{l('Önceki doğrulanmış analiz yerel önbellekten alındı.', 'Previously verified analysis loaded from the local cache.')}</p>}
        <p>{l('Kaynak', 'Source')} {timecode(analysis.duration ?? source?.duration ?? 0)} · {analysis.visual?.sceneCount ?? 0} {l('sahne', 'scenes')} · {analysis.visual?.samples ?? 0} {l('örnek kare', 'sampled frames')}</p>
        <p>{plan.filter(row => row.selected).length} {l('seçilen klip', 'selected clips')} · {(elapsed / 1000).toFixed(1)} s · {analysis.backend || l('Konuşma altyazısı yok', 'No speech captions')}</p>
        {analysis.speechUnavailable && <p>{copy.visual.speechUnavailable}</p>}
        {!!analysis.width && !!analysis.height && Math.min(analysis.width / 9, analysis.height / 16) < resolution / 9 && <p>{l('Kaynak büyütülecek. Çıktı çözünürlüğü yeni görüntü detayı kazandırmaz.', 'Source will be upscaled. Output resolution does not recover image detail.')}</p>}
        {plan.length < (count || 5) && <p>{l('Uygun puan ve çeşitlilik koşullarını sağlayan klip sayısı sınırlı.', 'Few clips met the score and diversity criteria.')}</p>}
        {analysis.visual && <p>SSD / Ultra-Light · {analysis.visual.models.join(' / ').toUpperCase()}</p>}
        {batch?.resources && <p>{l('Ana işlem, örneklenen RAM', 'Main process, sampled RAM')} {batch.resources.memoryMiB} MiB · CPU {batch.resources.cpuSeconds.toFixed(2)} s</p>}
        <p>{copy.semanticDisclaimer}</p>
      </div>}
      {plan.map((row, index) => <article className="auto-card" key={row.clip.id}>
        <strong>{copy.autoClip} {index + 1} · {timecode(editedDuration(row.item, row.item.remove), false)} · {row.clip.evaluation?.score ?? '—'}/100</strong>
        <p>{timecode(row.item.start)} – {timecode(row.item.end)} · {row.item.overlay?.cues.length ?? 0} {l('altyazı', 'captions')}</p>
        <p>{row.clip.evaluation?.reasons.map(reason => copy.semanticReasons[reason]).join(' · ')}</p>
        <p>{styleNames[profiles.indexOf(row.style)]} · {row.item.frame.fit ? l('Tam kare', 'Full frame') : row.item.frame.track?.length ? l('Konu takibi', 'Subject tracking') : l('Merkez kadraj', 'Center crop')}</p>
        {row.clip.picture?.wideFaces && !row.item.frame.fit && <p>{l('Örneklenen yüzlerden biri dikey kesimden geniş. Tam kareyi değerlendir.', 'A sampled face is wider than the portrait crop. Consider keeping the full frame.')}</p>}
        {!busy && <div className="auto-settings">
          <label>{copy.start}<input type="number" min={0} step=".01" key={row.item.start} defaultValue={Number(row.item.start.toFixed(3))}
            onBlur={e => { if (Math.abs(e.target.valueAsNumber - row.item.start) > .001) trim(index, 'start', e.target.valueAsNumber) }} /></label>
          <label>{copy.end}<input type="number" min={0} step=".01" key={row.item.end} defaultValue={Number(row.item.end.toFixed(3))}
            onBlur={e => { if (Math.abs(e.target.valueAsNumber - row.item.end) > .001) trim(index, 'end', e.target.valueAsNumber) }} /></label>
        </div>}
        <div className="shorts-actions">
          <label><input type="checkbox" checked={row.selected} disabled={busy} onChange={e => setPlan(current => current.map((item, i) => i === index ? { ...item, selected: e.target.checked } : item))} />{l('Dışa aktar', 'Export')}</label>
          <button className="export-cancel" disabled={busy} onClick={() => { setRendered(''); preview(row.item, row.item.overlay?.cues ?? [],
            row.item.overlay?.appearance ?? defaultAppearance, row.item.frame, row.item.remove, row.item.effects) }}>{copy.preview}</button>
          <button className="export-cancel" disabled={busy} onClick={() => { setRendered(''); preview(row.item, [], defaultAppearance, { mode: 'vertical', x: 0, y: 0, zoom: 1, fit: 'contain' }, []) }}>{l('Orijinal görüntü ve ses', 'Original picture and sound')}</button>
        </div>
      </article>)}
      {!busy && !!selected.length && <button className="primary" disabled={!valid} onClick={() => void run(true)}>{l('Planı MP4 ve proje olarak kaydet', 'Export plan as MP4 and projects')}</button>}
      {!busy && !valid && <p role="alert">{copy.autoInvalid}</p>}
      {batch?.items.map((item, index) => <article className="auto-card" key={index}>
        <strong>{index + 1} · {item.filename ?? copy.autoClip} · {item.phase === 'ready' ? l('Doğrulandı', 'Verified') : item.phase === 'failed' ? l('Başarısız', 'Failed') :
          item.phase === 'cancelled' ? l('İptal edildi', 'Cancelled') : Math.floor(item.progress) + '%'}</strong>
        {item.verification && <p>{item.verification.width} × {item.verification.height} · {item.verification.duration.toFixed(2)} s · {item.encoder} · {item.verification.audio ? l('Sesli', 'Audio') : l('Sessiz', 'Silent')}</p>}
        {item.decoder && <p>{l('Video çözme', 'Video decoding')} · {item.decoder.toUpperCase()}</p>}
        {item.quality && <p>{item.quality.integrated?.toFixed(1) ?? '—'} LUFS · {item.quality.peak?.toFixed(1) ?? '—'} dBTP · A/V Δ {item.quality.avDeltaMs} ms</p>}
        {item.warnings?.map(warning => <p key={warning}>{copy.qualityWarnings[warning]}</p>)}
        {item.retried && <p>{l('CPU ile yeniden denendi.', 'Retried on CPU.')}</p>}
        {item.error && <p role="alert">{copy.exportErrors[item.error]}</p>}
        {item.filename && !busy && <button className="export-cancel" onClick={() => void bridge?.director.reveal(item.filename!).catch(() => {})}>{l('MP4’ü aç', 'Open MP4')}</button>}
        {item.filename && !busy && <button className="export-cancel" onClick={() => setRendered(item.filename ?? '')}>{l('İşlenmiş görüntü ve ses', 'Processed picture and sound')}</button>}
      </article>)}
      {rendered && !busy && <div className="studio-render"><video src={'/studio-render/' + rendered} controls preload="metadata" aria-label={l('İşlenmiş çıktı', 'Processed output')} />
        <button className="export-cancel" onClick={() => setRendered('')}>{copy.close}</button></div>}
      {projectFiles.map((file, index) => <button key={file} disabled={busy} className="export-cancel" onClick={() => {
        void bridge?.director.project(index).then(result => { if (result.project) load(result.project); else setError(copy.projectError) }).catch(() => setError(copy.projectError))
      }}>{l('Projeyi aç', 'Open project')} {index + 1}</button>)}
      {folder && <button className="export-cancel" onClick={() => void bridge?.director.reveal('').catch(() => {})}>{l('Çıktı klasörünü aç', 'Open output folder')}</button>}
    </div>
  </section>
}
