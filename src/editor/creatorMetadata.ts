import type { Cue } from '../subtitles/model'

export const platforms = ['youtube', 'tiktok', 'instagram'] as const
export type Platform = typeof platforms[number]
export const creatorStyles = ['professional', 'curious', 'fun', 'education', 'gaming', 'minimal'] as const
export type CreatorStyle = typeof creatorStyles[number]
export type Metadata = { title: string; description: string; hashtags: string[]; keywords: string[] }
export type CalendarEntry = Metadata & { id: string; platform: Platform; plannedAt: string; filename?: string; status: 'planned' | 'ready' | 'draft' }
export type PlatformProfile = { id: Platform; name: string; min: number; max: number; fps: number; bitrate: number; bytes: number; title: number; caption: number }
export type YouTubeChannel = { id: string; name: string }
export type YouTubeState = { phase: 'uploading' | 'uploaded' | 'verified' | 'cancelled' | 'failed'; progress: number;
  id?: string; processing?: string; error?: string; visibility?: string; publishAt?: string;
  metrics?: { views?: string; likes?: string; comments?: string } }

const common = new Set(('about after again already also around because before being ben benim bile biraz bize bizim bura burada but bence cunku çok daha ' +
  'değil demek diye does from have hello here ile için into just kadar like merhaba nasıl neden olsun once only olarak orada really ' +
  'right sana says sen sizin some sonra than that their them then there these they this those through şöyle öyle üzere were what when where which while why will with would yani your').split(' '))
const text = (value: string) => value.replace(/[<>]/gu, '').replace(/\s+/gu, ' ').trim()
const fit = (value: string, limit: number) => [...value].length <= limit ? value : [...value].slice(0, limit - 1).join('').replace(/\s+\S*$/u, '') + '…'

export function suggestMetadata(cues: Cue[], range: { start: number; end: number }, objects: string[], language: 'tr' | 'en', style: CreatorStyle) {
  const transcript = [...new Set(cues.filter(cue => cue.start >= range.start - .01 && cue.end <= range.end + .01)
    .map(cue => text(cue.text)).filter(value => value.length >= 6))].slice(0, 30)
  const tokens = new Map<string, { count: number; shown: string }>()
  for (const line of transcript) for (const token of line.match(/[\p{L}][\p{L}\p{N}]{3,}/gu) ?? []) {
    const key = token.toLocaleLowerCase(language)
    if (!common.has(key)) tokens.set(key, { count: (tokens.get(key)?.count ?? 0) + 1, shown: token })
  }
  const tags = [...tokens.values()].sort((a, b) => b.count - a.count).slice(0, 6).map(value => value.shown)
  const observed = [...new Set(objects.filter(label => /^[a-z][a-z -]{1,23}$/.test(label)))].slice(0, 5)
  const topic = tags.length ? tags.slice(0, 3).join(' · ') : language === 'tr' ? 'Video kesiti' : 'Video excerpt'
  const prefix = language === 'tr' ? ({
    professional: 'Öne çıkan kesit', curious: 'Bu kesitte', fun: 'Kısa kesit', education: 'Konu özeti', gaming: 'Oyun kesiti', minimal: 'Video kesiti',
  })[style] : ({
    professional: 'Featured excerpt', curious: 'In this clip', fun: 'Quick cut', education: 'Topic notes', gaming: 'Gameplay excerpt', minimal: 'Video excerpt',
  })[style]
  const title = [prefix, topic].filter((value, i, all) => all.indexOf(value) === i).join(' · ')
  const titles = [...new Set([...transcript.slice(0, 3).map(line => fit('“' + line + '”', 96)), fit(title, 96),
    fit(topic + ' · ' + (language === 'tr' ? 'Kısa video' : 'Short video'), 96), fit(prefix + ' · ' + clock(range.start), 96),
    fit(topic + ' · ' + clock(range.start) + '–' + clock(range.end), 96), fit(prefix + ' · ' + clock(range.end), 96)])].slice(0, 5)
  const clip = clock(range.start) + '–' + clock(range.end)
  const short = fit(transcript[0] ?? (language === 'tr' ? 'Seçilen video kesiti · ' : 'Selected video excerpt · ') + clip, 245)
  const description = [short, transcript.length > 1 ? fit(transcript.slice(1, 5).join(' '), 800) : '',
    !transcript.length && observed.length ? (language === 'tr' ? 'Görsel model etiketleri · ' : 'Visual model labels · ') + observed.join(', ') : ''].filter(Boolean).join('\n\n')
  const keywords = tags.length ? tags : observed
  const hashtags = [...new Set(keywords.filter(word => /^\p{L}[\p{L}\p{N}]{2,28}$/u.test(word)).slice(0, 5).map(word => '#' + word))]
  return { titles, title: titles[0], short, description, keywords, hashtags, evidence: transcript.length ? 'speech' : observed.length ? 'vision' : 'range' }
}

function clock(value: number) {
  const seconds = Math.max(0, Math.floor(value))
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}
