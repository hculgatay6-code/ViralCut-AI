import type { Project } from '../project/model'
import type { CreatorIntent } from './CreatorPanel'

const colors = { yellow: '#ffe45e', white: '#ffffff', green: '#b7fa70', blue: '#7ecaff', red: '#ff7373' }
export type Color = keyof typeof colors
export { colors }
export type Step =
 | { tool: 'trim' | 'length' | 'seek'; seconds: number; index: number }
 | { tool: 'cutRange'; start: number; end: number; index: number }
 | { tool: 'remove' | 'select' | 'brighten'; index: number }
 | { tool: 'captions'; color: Color }
 | { tool: 'captionStyle'; style: 'classic' | 'bold' | 'box' | 'current' }
 | ({ tool: 'creator' } & CreatorIntent)
 | { tool: 'shorts'; count: number; goal: number }
 | { tool: 'frame'; mode: 'vertical' | 'square' | 'landscape' | 'track' }
 | { tool: 'undo' | 'redo'; count: number }
 | { tool: 'export'; resolution: 0 | 720 | 1080 }
 | { tool: 'join' | 'silence' | 'transcribe' | 'audio' | 'size' | 'effects' | 'polish' | 'save' | 'inspect' | 'choose' }

type Context = { index?: number; shorts?: boolean }
type Result = { steps: Step[] } | { error: 'unsupported' | 'clarify' | 'unsafe' | 'empty'; detail?: string }
const plain = (text: string) => text.toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i')
const ordinals = ['first|birinci|ilk', 'second|ikinci', 'third|ucuncu', 'fourth|dorduncu', 'fifth|besinci']
const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, thirty: 30, sixty: 60,
 bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, on: 10, 'on bes': 15, otuz: 30, altmis: 60 }
const numeric = 'on bes|fifteen|thirty|sixty|altmis|otuz|one|two|three|four|five|ten|bir|iki|uc|dort|bes|on|\\d+(?:[.,]\\d+)?'
const values = (text: string) => [...text.matchAll(new RegExp('\\b(' + numeric + ')\\b', 'g'))].map(m => numberWords[m[1]] ?? Number(m[1].replace(',', '.')))
const has = (text: string, pattern: RegExp) => pattern.test(text)
const negative = /\b(don't|do not|never|without|yapma|etme|kaydetme|silme|kesme|olmadan|istemiyorum|istemem|alma|kaldirma|temizleme|artirma|azaltma|degistirme|olusturma|uygulama)\b/

export function parseCopilot(text: string, context: Context = {}): Result {
 if (!text.trim()) return { error: 'empty' }
 if (text.length > 1200 || /[\\`<>|$]|https?:|\b(?:powershell|cmd\.exe|bash|exec|system32|sudo|terminal)\b/i.test(text)) return { error: 'unsafe' }
 const normalized = plain(text).trim().replace(/^viralcut[,: ]+/, '')
 if (/\b(yukle.*(?:bulut|youtube)|upload|download|internetten|publish|paylas|delete (?:my|the) (?:video|file)|dosya(?:yi|lari) sil)\b/.test(normalized)) return { error: 'unsafe' }
 const platform = /\btiktok\b/.test(normalized) ? 'tiktok' : /\binstagram\b/.test(normalized) ? 'instagram' : /\byoutube\b/.test(normalized) ? 'youtube' : undefined
 const action = /\b(takvim\w*|calendar)\b/.test(normalized) ? 'calendar' :
  /\b(baslik\w*|titles?)\b/.test(normalized) && /\b(yaz|uret|write|generate|oner)\b/.test(normalized) ? 'titles' :
  platform && /\b(kapak\w*|cover|thumbnail)\b/.test(normalized) ? 'cover' :
  /\b(uc platform\w*|three platforms|platform paket\w*)\b/.test(normalized) ? 'packages' :
  (platform === 'tiktok' || platform === 'instagram' || platform === 'youtube' && /\byoutube shorts\b/.test(normalized)) &&
    /\b(versiyon|version|shorts|shorter|reels|klip|hazirla|olustur)\b/.test(normalized) ? 'shorts' : undefined
 if (action && !negative.test(normalized)) {
  const count = action === 'shorts' ? values(normalized).find(n => Number.isInteger(n) && n >= 1 && n <= 5) : undefined
  const steps: Step[] = [{ tool: 'creator', action, ...(platform ? { platform } : {}), ...(count ? { count } : {}) }]
  validateSteps(steps)
  return { steps }
 }
 const chunks = normalized.replace(/(\d)\s+(?:ile|ve|and)\s+(?=\d)/g, '$1–')
  .split(/\s*(?:[;!?\n]+|[.,](?!\d)|\b(?:and then|then|ardindan|sonra|ve|ayrica|and)\b)\s*/).filter(Boolean)
 const steps: Step[] = []
 let index = context.index ?? -1
 for (const raw of chunks) {
  const part = raw.replace(/^(?:please|lutfen|could you|can you)\s+/, '').replace(/(?:[’'])(?:u|i|yi|nin|in)\b/g, '').trim()
  if (!part || /^(?:please|lutfen|thanks|tesekkurler)$/.test(part)) continue
  if (negative.test(part) || /\b(komik|funny|hilarious|viral|en duygusal|buy my|meme)\b/.test(part)) return { error: 'unsupported', detail: raw }
  const ordinal = ordinals.findIndex(pattern => has(part, new RegExp('\\b(?:' + pattern + ')\\s+(?:clip|klib)\\w*\\b')))
  const standaloneOrdinal = ordinals.findIndex(pattern => has(part, new RegExp('\\b(?:' + pattern + ')(?:yi|ni|yu|nu)\\b')))
  const writtenIndex = /\b(?:clip|klip)\s+#?(\d+)\b/.exec(part)
  const numbered = writtenIndex ? Number(writtenIndex[1]) - 1 : ordinal >= 0 ? ordinal : standaloneOrdinal
  const explicitOrdinal = numbered >= 0
  if (numbered >= 0) index = numbered
  const nums = values(part)
  const seconds = new RegExp('\\b(' + numeric + ')[\\s-]*(?:seconds?\\b|secs?\\b|saniye\\w*\\b|sn\\b|s\\b)').exec(part)
  const time = /\b(\d{1,3}):(\d\d)\b/.exec(part)
  const amount = seconds ? values(seconds[1])[0] : time ? Number(time[1]) * 60 + Number(time[2]) : undefined
  const color = (Object.entries({ yellow: /\b(yellow|sari\w*)\b/, white: /\b(white|beyaz\w*)\b/, green: /\b(green|yesil\w*)\b/,
   blue: /\b(blue|mavi\w*)\b/, red: /\b(red|kirmizi\w*)\b/ }) as [Color, RegExp][]).find(([, regex]) => regex.test(part))?.[0]
  const removal = /\b(remove|delete|drop|cikar|kaldir|sil|at|kes|cut)\b/.test(part)
  const section = /\b(?:from\s+)?(\d+(?:[.,]\d+)?|\d+:\d\d)\s*(?:s|sn|seconds?)?\s*(?:-|–|to|ile|ve)\s*(\d+:\d\d|\d+(?:[.,]\d+)?)\s*(?:saniye\w*|seconds?|sn|s)?\b/.exec(part)
  const sectionTime = (s: string) => s.includes(':') ? Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]) : Number(s.replace(',', '.'))
  if (/\b(undo|geri al)\b/.test(part)) steps.push({ tool: 'undo', count: nums[0] ?? 1 })
  else if (/\b(redo|yinele|yeniden yap|ileri al)\b/.test(part)) steps.push({ tool: 'redo', count: nums[0] ?? 1 })
  else if (/\b(kaliteyi kontrol|quality check|check quality|inspect|what can|ne onerirsin|oneri ver)\b/.test(part)) steps.push({ tool: 'inspect' })
  else if (/\b(proje\w* kaydet|save (?:the |this )?project|save my project)\b/.test(part)) steps.push({ tool: 'save' })
  else if (/\b(export|disa aktar|render|kaydet|save)\b/.test(part) && /\b(mp4|1080p|720p|export|disa aktar|render)\b/.test(part) &&
   !/\bshorts?\b/.test(part)) steps.push({ tool: 'export', resolution: part.includes('1080') ? 1080 : part.includes('720') ? 720 : 0 })
  else if (/\b(seek|jump|go to|atla|git)\b/.test(part)) {
   if (amount === undefined) return { error: 'clarify', detail: raw }
   steps.push({ tool: 'seek', seconds: amount, index })
  } else if (/\b(choose (?:a |the )?video|open (?:a |the )?video|video sec|video ac)\b/.test(part)) steps.push({ tool: 'choose' })
  else if (/\b(sessizlik\w*|sessiz bolum\w*|silence\w*|silent (?:sections|parts)|pauses|bosluklari)\b/.test(part) && /\b(remove|cut|clean|strip|trim|delete|skip|temizle|kaldir|cikar|sil|kes|at)\b/.test(part)) steps.push({ tool: 'silence' })
  else if (color && /\b(captions?|subtitles?|altyazi\w*)\b/.test(part)) steps.push({ tool: 'captions', color })
  else if (removal && section) steps.push({ tool: 'cutRange', start: sectionTime(section[1]), end: sectionTime(section[2]), index })
  else if (/\b(9\s*:\s*16|vertical|portrait|dikey|16\s*:\s*9|horizontal|landscape|yatay|square|kare|1\s*:\s*1)\b/.test(part) && !/\bshorts?\b/.test(part)) {
   steps.push({ tool: 'frame', mode: /16\s*:\s*9|horizontal|landscape|yatay/.test(part) ? 'landscape' :
    /1\s*:\s*1|square|kare/.test(part) ? 'square' : 'vertical' })
  } else if (/\b(yuz\w*|face|subject|speaker)\b/.test(part) && /\b(kadraj\w*|takip|track|frame|center)\b/.test(part)) steps.push({ tool: 'frame', mode: 'track' })
  else if (/\b(shorts?|highlights?|one cikan|en (?:iyi|guzel|heyecanli)|best|top)\b/.test(part) &&
      /\b(shorts?|moments?|scenes?|an\w*|sahne\w*|clips?|highlight\w*)\b/.test(part)) {
   const count = nums.find(num => num !== amount && num > 0 && num <= 10) ?? steps.find(step => step.tool === 'shorts')?.count ?? 3
   if (/\b\d{2,}\s*(?:shorts?|tane|klip|clips?)\b/.test(part) && nums.some(num => num > 10 && num !== amount)) return { error: 'clarify', detail: raw }
   const prior = steps.findIndex(step => step.tool === 'shorts')
   if (prior < 0) steps.push({ tool: 'shorts', count, goal: amount ?? 30 })
   else steps[prior] = { tool: 'shorts', count, goal: amount ?? 30 }
   if (/\b(mp4|export|disa aktar)\b/.test(part)) steps.push({ tool: 'export', resolution: part.includes('1080') ? 1080 : part.includes('720') ? 720 : 0 })
  } else if (/\b(geri kalan\w*|kalan\w*|remaining|all of them)\b/.test(part) && amount !== undefined && context.shorts) {
   steps.push({ tool: 'length', seconds: amount, index: -2 })
  } else if (/\b(remove|delete|drop|cikar|kaldir|sil|at)\b/.test(part) && amount === undefined && index >= 0 &&
      (explicitOrdinal || /\b(it|onu|clip|klib\w*)\b/.test(part))) steps.push({ tool: 'remove', index })
  else if (amount !== undefined && /\b(kisalt|trim|cut|skip|remove|kaldir|kes|cikar|shorten)\b/.test(part)) {
   steps.push({ tool: /\b(first|ilk|start|bastan|basindan)\b/.test(part) ? 'trim' : 'length', seconds: amount, index })
  } else if (/\b(merge|join|combine|birlestir)\b/.test(part)) steps.push({ tool: 'join' })
  else if (/\b(captions?|subtitles?|altyazi\w*)\b/.test(part)) {
   if (/\b(buyut|buyuk|bigger|larger|increase size|enlarge)\b/.test(part)) steps.push({ tool: 'size' })
   else if (/\b(olustur|ekle|uret|add|generate|transcribe|create|automatic|otomatik)\b/.test(part)) steps.push({ tool: 'transcribe' })
   else if (/\b(style|stil\w*|gorunum)\b/.test(part) && /\b(kalin|bold|box\w*|kutu\w*|classic|klasik|same|ayni)\b/.test(part))
    steps.push({ tool: 'captionStyle', style: /\b(kalin|bold)\b/.test(part) ? 'bold' : /\b(box\w*|kutu\w*)\b/.test(part) ? 'box' :
      /\b(same|ayni)\b/.test(part) ? 'current' : 'classic' })
   else return { error: 'clarify', detail: raw }
  } else if (/\b(parlak\w*|brighten|brighter|brightness)\b/.test(part)) steps.push({ tool: 'brighten', index })
  else if (/\b(konusma sesi\w*|ses\w*|voice|audio|loudness|volume|noise)\b/.test(part) &&
      /\b(artir|boost|normalize|master|iyilestir|denge\w*|temizle|raise|louder|reduce|improve|enhance|level)\b/.test(part)) steps.push({ tool: 'audio' })
  else if (/\b(efekt\w*|effects?)\b/.test(part) && /\b(azalt|reduce|less|remove|kapat|disable|fewer)\b/.test(part)) steps.push({ tool: 'effects' })
  else if (/\b(profesyonel|professional|polish)\b/.test(part)) steps.push({ tool: 'polish' })
  else if (index >= 0 && /\b(select|choose|sec|secili)\b/.test(part)) steps.push({ tool: 'select', index })
  else return { error: 'clarify', detail: raw }
 }
 try { validateSteps(steps); return { steps } } catch { return { error: 'clarify' } }
}

export function validateSteps(steps: Step[]) {
 const integer = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max
 if (!Array.isArray(steps) || !steps.length || steps.length > 12) throw Error('plan')
 for (const step of steps) {
  const keys = (fields: string) => Object.keys(step).every(key => ('tool ' + fields).split(' ').includes(key))
  const valid = (() => {
   switch (step.tool) {
    case 'trim': case 'length': case 'seek': return keys('seconds index') && Number.isFinite(step.seconds) && step.seconds >= (step.tool === 'seek' ? 0 : .01) &&
      step.seconds <= 86400 && integer(step.index, -2, 499) && (step.index !== -2 || (step.tool === 'length' && [15, 30, 60].includes(step.seconds)))
    case 'remove': case 'select': case 'brighten': return keys('index') && integer(step.index, step.tool === 'brighten' ? -1 : 0, 499)
    case 'shorts': return keys('count goal') && integer(step.count, 1, 10) && [15, 30, 60].includes(step.goal)
    case 'frame': return keys('mode') && ['vertical', 'square', 'landscape', 'track'].includes(step.mode)
    case 'captions': return keys('color') && Object.hasOwn(colors, step.color)
    case 'captionStyle': return keys('style') && ['classic', 'bold', 'box', 'current'].includes(step.style)
    case 'creator': return keys('action platform count') && ['shorts', 'titles', 'cover', 'calendar', 'packages'].includes(step.action) &&
      (step.platform === undefined || ['youtube', 'tiktok', 'instagram'].includes(step.platform)) &&
      (step.count === undefined || integer(step.count, 1, 5))
    case 'cutRange': return keys('start end index') && Number.isFinite(step.start) && Number.isFinite(step.end) &&
      step.start >= 0 && step.end > step.start && step.end <= 86400 && integer(step.index, -1, 499)
    case 'export': return keys('resolution') && [0, 720, 1080].includes(step.resolution)
    case 'undo': case 'redo': return keys('count') && integer(step.count, 1, 40)
    case 'join': case 'silence': case 'transcribe': case 'audio': case 'size': case 'effects': case 'polish':
    case 'save': case 'inspect': case 'choose': return keys('')
    default: return false
   }
  })()
  if (!valid) throw Error('plan')
 }
 if (steps.length > 1 && steps.some(step => ['undo', 'redo', 'choose', 'inspect', 'creator'].includes(step.tool))) throw Error('plan')
}

export function projectEdit(project: Project, step: Step, selected: string): Project {
 if (step.tool === 'captions') return { ...project, burn: true, appearance: { ...project.appearance, textColor: colors[step.color], highlightColor: colors[step.color] } }
 if (step.tool === 'size') return { ...project, appearance: { ...project.appearance, size: Math.min(100, project.appearance.size + 8) } }
 if (step.tool === 'captionStyle') return { ...project, burn: true,
  appearance: { ...project.appearance, style: step.style === 'current' ? project.appearance.style : step.style } }
 if (step.tool === 'audio' || step.tool === 'polish') return { ...project, mastering: { target: -16, musicLevel: .14 } }
 if (step.tool === 'effects') return { ...project, clips: project.clips.map(clip => ({ ...clip, effects: undefined, transition: undefined })) }
 if (step.tool === 'frame' && step.mode !== 'track') return { ...project, frame: { mode: step.mode, x: 0, y: 0, zoom: 1 } }
 if (step.tool === 'join') {
  if (project.clips.length < 2) throw Error('clips')
  return project
 }
 if (step.tool !== 'trim' && step.tool !== 'length' && step.tool !== 'remove' && step.tool !== 'brighten' && step.tool !== 'cutRange') return project
 const index = step.index < 0 ? Math.max(0, project.clips.findIndex(clip => clip.id === selected)) : step.index
 const clip = project.clips[index]
 if (!clip) throw Error('clips')
 if (step.tool === 'remove') return { ...project, clips: project.clips.filter((_, position) => position !== index) }
 if (step.tool === 'cutRange') {
  if (step.start < clip.start || step.end > clip.end) throw Error('range')
  const parts = [{ ...clip, end: step.start }, { ...clip, start: step.end }].filter(part => part.end - part.start >= 1 / project.profile.fps)
  if (!parts.length || project.clips.length + parts.length - 1 > 500) throw Error('range')
  if (parts.length === 2) { parts[0].transition = undefined; parts[1].id = crypto.randomUUID() }
  return { ...project, clips: project.clips.flatMap((item, i) => i === index ? parts : [item]) }
 }
 const next = 'seconds' in step ? step.tool === 'trim' ? { ...clip, start: clip.start + step.seconds } : { ...clip, end: clip.end - step.seconds } :
  { ...clip, effects: { ...clip.effects, brightness: Math.min(.18, (clip.effects?.brightness ?? 0) + .035) } }
 if (next.end - next.start < 1 / project.profile.fps) throw Error('range')
 return { ...project, clips: project.clips.map((item, position) => position === index ? next : item) }
}
