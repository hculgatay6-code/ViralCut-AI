import { useEffect, useRef, useState } from 'react'
import { ExportClientError, localExporter } from '../export/client'
import type { Copy, Language } from '../i18n'
import type { Project } from '../project/model'
import { parseCopilot } from './copilotPlan'
import type { Step } from './copilotPlan'
import { executeCopilot, finished } from './copilotRunner'
import type { ShortContext, Source } from './copilotRunner'
import { recordCommand } from './copilotVoice'
import type { CreatorIntent } from './CreatorPanel'

const tools = {
 layerLook: ['Klip görünümü', 'Clip look'],
 trim: ['Baştan kes', 'Trim from start'], length: ['Kısalt', 'Shorten'], seek: ['Zamana git', 'Seek'],
 remove: ['Klibi kaldır', 'Remove clip'], select: ['Klibi seç', 'Select clip'], brighten: ['Parlaklığı artır', 'Brighten clip'],
 captions: ['Altyazı rengi', 'Caption color'], shorts: ['Shorts adayları', 'Shorts candidates'], frame: ['Kadraj', 'Framing'],
 undo: ['Geri al', 'Undo'], redo: ['Yinele', 'Redo'], export: ['MP4 kaydet', 'Save MP4'], join: ['Klipleri tek MP4’te birleştir', 'Join clips into one MP4'],
 silence: ['Sessizliği temizle', 'Remove silence'], transcribe: ['Yerel altyazı oluştur', 'Transcribe locally'], audio: ['Sesi −16 LUFS hedefiyle işle', 'Master to −16 LUFS'],
 size: ['Altyazıyı büyüt', 'Enlarge captions'], effects: ['Efekt ve geçişleri kaldır', 'Remove effects and transitions'],
 cutRange: ['Aralığı çıkar', 'Remove range'], captionStyle: ['Altyazı stili', 'Caption style'],
 creator: ['Yayın Stüdyosu', 'Publishing Studio'],
 polish: ['Sese dengeli mastering uygula', 'Apply balanced audio mastering'], save: ['Projeyi kaydet', 'Save project'],
 inspect: ['Kaynakta ölçülen sessizliği incele', 'Inspect measured source silence'], choose: ['Video seç', 'Choose video'],
}
function description(step: Step, lang: Language) {
 const label = tools[step.tool][lang === 'tr' ? 0 : 1]
 const colors = { yellow: 'Sarı', green: 'Yeşil', blue: 'Mavi', red: 'Kırmızı', white: 'Beyaz' }
 if (step.tool === 'layerLook') return label + ' · ' + ({cinematic:'Cinematic Glow',gaming:'Gaming RGB',oldfilm:'Vintage Film',dissolve:'Cross Dissolve',action:'Fast Action'})[step.preset] + (step.preset==='action' ? (lang==='tr'?' · öneri, paket kütüphanesinde':' · suggestion in the preset library') : '')
 if (step.tool === 'captions') return label + ' · ' + (lang === 'tr' ? colors[step.color] : step.color)
 if (step.tool === 'shorts') return label + ' · ≤' + step.count + ' / ' + step.goal + ' s'
 if (step.tool === 'frame') return label + ' · ' + ({ vertical: '9:16', square: '1:1', landscape: '16:9', track: lang === 'tr' ? 'Konu takibi' : 'Track subject' })[step.mode]
 if (step.tool === 'export') return label + (step.resolution ? ' · ' + step.resolution + 'p' : '')
 if (step.tool === 'creator') return [label, step.platform, (lang === 'tr' ?
  { shorts: 'Klip hazırla', titles: 'Başlık öner', cover: 'Kapak düzenle', calendar: 'Takvimi aç', packages: 'Paketleri hazırla' } :
  { shorts: 'Prepare clips', titles: 'Suggest titles', cover: 'Edit cover', calendar: 'Open calendar', packages: 'Prepare packages' })[step.action],
  step.count].filter(Boolean).join(' · ')
 if (step.tool === 'cutRange') return label + ' · ' + step.start + '–' + step.end + ' s' + (step.index < 0 ? '' : ' · #' + (step.index + 1))
 if (step.tool === 'captionStyle') return label + ' · ' + (lang === 'tr' ? { classic: 'Klasik', bold: 'Kalın', box: 'Kutulu', current: 'Mevcut' }[step.style] : step.style)
 return [label, 'index' in step && step.index >= 0 ? '#' + (step.index + 1) : '',
  'seconds' in step ? step.seconds + ' s' : '', 'count' in step ? '×' + step.count : ''].filter(Boolean).join(' · ')
}

export function CopilotPanel({ visible, language, copy, project, selected, layerSelected, source, keyId, apply, history, choose, select, close, compare, before, previewShort, creator }: {
 visible: boolean; language: Language; copy: Copy; project: Project; selected: string; layerSelected?:string; source?: Source; keyId: number
 apply: (expected: Project, next: Project) => void; history: (tool: 'undo' | 'redo', count: number) => boolean
 choose: () => Promise<boolean>; select: (index: number, time?: number) => boolean; close: () => void
 compare: boolean; before: () => void; previewShort: (context: ShortContext, index: number) => void
 creator: (intent: CreatorIntent) => void
}) {
 const tr = language === 'tr'
 const l = (turkish: string, english: string) => tr ? turkish : english
 const [input, setInput] = useState('')
 const [messages, setMessages] = useState<{ from: 'user' | 'assistant'; text: string }[]>([])
 const [pending, setPending] = useState<{ steps: Step[]; project: Project; source?: string; selected: string; layerSelected?:string }>()
 const [short, setShort] = useState<ShortContext>()
 const [shortHistory, setShortHistory] = useState<{ undo: (ShortContext | undefined)[]; redo: (ShortContext | undefined)[] }>({ undo: [], redo: [] })
 const [index, setIndex] = useState<number>()
 const [progress, setProgress] = useState<number>()
 const [stop, setStop] = useState<() => void>()
 const [voiceActive, setVoiceActive] = useState(false)
 const [outputFolder, setOutputFolder] = useState(false)
 const operation = useRef<AbortController | undefined>(undefined)
 const status = useRef({ project, source: source?.media.id, selected, layerSelected })
 useEffect(() => { status.current = { project, source: source?.media.id, selected, layerSelected } }, [project, source?.media.id, selected, layerSelected])
 useEffect(() => {
  operation.current?.abort()
  setMessages([]); setPending(undefined); setShort(undefined); setShortHistory({ undo: [], redo: [] }); setIndex(undefined); setOutputFolder(false)
 }, [keyId, source?.media.id])
 useEffect(() => {
  if (!visible && voiceActive) operation.current?.abort()
 }, [visible, voiceActive])
 useEffect(() => () => operation.current?.abort(), [])
 const append = (from: 'user' | 'assistant', text: string) => setMessages(rows => [...rows.slice(-39), { from, text }])

 function moveHistory(tool: 'undo' | 'redo', count: number) {
  if (!shortHistory.undo.length && !shortHistory.redo.length) return history(tool, count)
  if (shortHistory[tool].length < count) return false
  let present = short
  const opposite = tool === 'undo' ? 'redo' : 'undo'
  const back = [...shortHistory[tool]], forward = [...shortHistory[opposite]]
  for (let i = 0; i < count; i++) { forward.push(present); present = back.pop() }
  setShortHistory({ [tool]: back, [opposite]: forward } as typeof shortHistory)
  setShort(present); setIndex(undefined)
  return true
 }

 function propose(text: string) {
  if (!text.trim() || operation.current) return
  append('user', text)
  setInput('')
  const result = parseCopilot(text, { index, shorts: !!short?.rows.length })
  if ('error' in result) {
   setPending(undefined)
   const answer = result.error === 'unsafe' ? l('Bu işlem yerel düzenleme araçlarının kapsamı dışında.', 'This is outside the local editing tools.') :
    result.error === 'unsupported' ? l('Bu isteği güvenilir biçimde uygulayamıyorum. Örneğin sessizliği temizlemeyi veya bir klibi kısaltmayı isteyebilirsin.',
     'This request is unsupported. Try removing silence or trimming a clip.') :
    l('Hangi klibi, süreyi veya işlemi istediğini belirtir misin?', 'Which clip, duration or editing action do you mean?')
   append('assistant', answer)
   return
  }
  setPending({ steps: result.steps, project, source: source?.media.id, selected, layerSelected })
 }

 function failure(error: unknown) {
  if (error instanceof ExportClientError) return copy.exportErrors[error.code]
  const reason = error instanceof Error ? error.message : ''
  const hints: Record<string, string> = {
   stale: l('Kaynak veya proje değişti. Yeni bir plan oluştur.', 'The source or project changed. Create a new plan.'),
   clips: l('Bu klip yok veya birleştirme için iki klip gerekiyor.', 'That clip is missing, or the merge needs two clips.'),
   range: l('Bu süre klibin kullanılabilir aralığına uymuyor.', 'That time is outside the available range.'),
   source: l('Önce kaynak videoyu seç.', 'Choose a source video first.'),
   cancelled: l('İşlem iptal edildi.', 'Operation cancelled.'),
   microphone: l('Mikrofon açılamadı. Windows mikrofon iznini kontrol et veya komutu yaz.', 'Microphone unavailable. Check Windows permission or type the command.'),
   captionsMissing: l('Bu aralıkta altyazı bulunamadı.', 'No captions found in this range.'),
   noCandidates: l('Bu kaynakta uygun Shorts adayı bulunamadı.', 'No suitable Shorts candidates were found.'),
   subjectMissing: l('Güvenilir konu takibi bulunamadı.', 'No reliable subject track was found.'),
   shortFrame: l('Shorts listesi dikeydir. Yatay veya kare çıktı için zaman çizelgesini kullan.', 'Shorts outputs are portrait. Use the timeline for landscape or square.'),
   history: l('İstenen sayıda geçmiş adımı yok.', 'That many history steps are unavailable.'),
  }
  if (reason==='effectSelection') return l('Katmanlı düzen üzerinde kilitsiz bir video klibi seç.', 'Select an unlocked video clip in the layered timeline.')
  if (reason==='effectLimit') return l('Bu klibin efekt zinciri dolu.', 'The clip effect stack is full.')
  if (reason==='effectAdjacent') return l('Geçiş için aynı izde bitişik bir klip gerekir.', 'The transition needs an adjacent clip on the same track.')
  return hints[reason] ?? copy.exportErrors[reason as keyof typeof copy.exportErrors] ?? copy.exportErrors.serviceError
 }

 async function confirm() {
  if (!pending || operation.current) return
  if (status.current.project !== pending.project || status.current.source !== pending.source || status.current.selected !== pending.selected || status.current.layerSelected !== pending.layerSelected) {
   setPending(undefined); append('assistant', failure(Error('stale'))); return
  }
  const controller = new AbortController()
  operation.current = controller
  setProgress(0); setPending(undefined)
  const { steps } = pending
  try {
   const first = steps[0]
   if (first.tool === 'creator') {
    creator(first); append('assistant', description(first, language))
   } else if (first.tool === 'undo' || first.tool === 'redo') {
    if (!moveHistory(first.tool, first.count)) throw Error('history')
    append('assistant', description(first, language))
   } else if (first.tool === 'choose') {
    if (!(await choose())) throw Error('cancelled')
    append('assistant', description(first, language))
   } else {
    const applied = await executeCopilot(steps, { project, selected, layerSelected, source, short, language, signal: controller.signal,
     current: () => status.current.project === project && status.current.source === pending.source && status.current.layerSelected === pending.layerSelected, select,
     progress: setProgress, onStep: (step, note) => append('assistant',
      description(step, language) + (note === undefined ? '' : ' · ' + note)) })
    if (applied.project !== project) apply(project, applied.project)
    if (applied.short !== short) {
     setShortHistory(value => ({ undo: [...value.undo.slice(-11), short], redo: [] }))
     setShort(applied.short)
    }
    if (applied.output) {
     setOutputFolder(true)
     append('assistant', l('Kaydedilen MP4', 'Saved MP4s') + ' · ' + applied.output.ready + '/' + applied.output.wanted +
      (applied.output.failed ? ' · ' + l('Başarısız', 'Failed') + ' ' + applied.output.failed : ''))
     for (const warning of applied.output.warnings) append('assistant', copy.qualityWarnings[warning as keyof typeof copy.qualityWarnings] ?? warning)
    }
    const last = steps.filter(step => 'index' in step && step.index >= 0).at(-1)
    if (last && 'index' in last) setIndex(last.tool === 'remove' ? undefined : last.index)
   }
  } catch (error) { append('assistant', failure(controller.signal.aborted ? Error('cancelled') : error)) }
  finally { if (operation.current === controller) operation.current = undefined; setProgress(undefined) }
 }

 async function voice() {
  if (operation.current) return
  const controller = new AbortController()
  operation.current = controller
  setVoiceActive(true); setProgress(0)
  let text = '', job: string | undefined
  try {
   const file = await recordCommand(controller.signal, finish => setStop(() => finish))
   setStop(undefined)
   const active = await localExporter.createTranscript(file, language, 'auto', true)
   job = active.id
   await localExporter.upload(active.id, file, controller.signal, setProgress)
   await finished(active, controller.signal, setProgress)
   text = (await localExporter.transcript(active.id, controller.signal)).cues.map(cue => cue.text).join(' ').trim()
   if (!text) throw Error('captionsMissing')
  } catch (error) {
   append('assistant', failure(controller.signal.aborted ? Error('cancelled') :
    error instanceof DOMException && ['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(error.name) ? Error('microphone') : error))
  } finally {
   if (job) await localExporter.release(job)
   setStop(undefined); setVoiceActive(false); setProgress(undefined)
   if (operation.current === controller) operation.current = undefined
  }
  if (text && !controller.signal.aborted) propose(text)
 }

 return <section className="panel copilot-panel" hidden={!visible} aria-label="AI Copilot">
  <header className="panel-header"><h2>AI Copilot</h2><button className="export-cancel" onClick={close}>{copy.close}</button></header>
  <div className="auto-shorts-body">
   <p>{l('Yerel komutlar · Türkçe ve İngilizce', 'Local commands · Turkish and English')}</p>
   {source && <p>{source.media.name}</p>}
   <div className="copilot-log" role="log">{messages.map((message, i) => <p key={i} data-from={message.from}>{message.text}</p>)}</div>
   <form onSubmit={event => { event.preventDefault(); propose(input) }}>
    <textarea aria-label={l('Düzenleme komutu', 'Editing command')} value={input} maxLength={1200}
     placeholder={l('Örn. İlk 10 saniyeyi kaldır ve 1080p MP4 kaydet.', 'E.g. Remove the first 10 seconds and save a 1080p MP4.')}
     onChange={event => setInput(event.target.value)} />
    <div className="shorts-actions">
     <button className="primary" disabled={progress !== undefined || !input.trim()}>{l('Plan oluştur', 'Create plan')}</button>
     <button type="button" className="export-cancel" disabled={progress !== undefined && !stop} onClick={() => { if (stop) stop(); else void voice() }}>
      {stop ? l('Kaydı bitir', 'Finish recording') : l('Mikrofonla konuş', 'Speak into microphone')}</button>
    </div>
   </form>
   {pending && <div className="copilot-plan" aria-label={l('Düzenleme planı', 'Editing plan')}>
    <strong>{l('Düzenleme planı', 'Editing plan')}</strong>
    <ol>{pending.steps.map((step, i) => <li key={i}>{description(step, language)}</li>)}</ol>
    <button className="primary" disabled={progress !== undefined} onClick={() => void confirm()}>{l('Planı uygula', 'Apply plan')}</button>
    <button className="export-cancel" onClick={() => setPending(undefined)}>{l('Reddet', 'Reject')}</button>
   </div>}
   {progress !== undefined && <div className="shorts-actions"><progress aria-label={copy.exportProgress} max={100} value={progress} />
    <button className="export-cancel" onClick={() => operation.current?.abort()}>{copy.exportCancel}</button></div>}
   {short?.rows.map((row, i) => <div className="shorts-actions" key={row.clip.id}>
    <span>{l('Aday', 'Candidate')} {i + 1} · {row.item.start.toFixed(1)}–{row.item.end.toFixed(1)} s</span>
    <button className="export-cancel" disabled={progress !== undefined} onClick={() => previewShort(short, i)}>{copy.preview}</button>
   </div>)}
   <div className="shorts-actions">
    <button className="export-cancel" disabled={progress !== undefined} onClick={before}>{compare ? l('İşlenmiş görüntü', 'Edited view') : l('Önceki görüntü', 'Original picture')}</button>
    <button className="export-cancel" disabled={progress !== undefined} onClick={() => moveHistory('undo', 1)}>{copy.undo}</button>
    <button className="export-cancel" disabled={progress !== undefined} onClick={() => moveHistory('redo', 1)}>{copy.redo}</button>
    {outputFolder && <button className="export-cancel" onClick={() => void window.viralCutDesktop?.director.reveal('')}>{l('Çıktı klasörünü aç', 'Open output folder')}</button>}
    <button className="export-cancel" disabled={progress !== undefined} onClick={() => { setMessages([]); setPending(undefined); setShort(undefined); setShortHistory({ undo: [], redo: [] }); setIndex(undefined) }}>
     {l('Sohbeti temizle', 'Clear chat')}</button>
   </div>
  </div>
 </section>
}
