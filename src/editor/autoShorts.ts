import type { Cue } from '../subtitles/model'
import type { ClipRange } from './model'

export type ClipMetrics = Partial<Record<'coherence' | 'hook' | 'completion' | 'silence' | 'captions' | 'length' | 'similarity' | 'energy' | 'scene' | 'timing' | 'motion', number | null>>
export type ClipEvaluation = { score: number; metrics: ClipMetrics; reasons: ('qa' | 'topic' | 'completed' | 'standalone' | 'scene' | 'energy' | 'motion' | 'change' | 'objects')[] }
export type Candidate = ClipRange & { id: number; text: string; boundaries: number; speech: number; selected: boolean; evaluation?: ClipEvaluation;
  visual?: { motion: number; events: number; objects: string[] }; track?: { time: number; x: number }[]
  picture?: { light: number; bright: number; tint: number; cuts: number[]; wideFaces: boolean } }
export const pauseSettings = { threshold: -38, minimum: .55, padding: .18 }

export function safePauses(range: ClipRange, silences: ClipRange[], cues: Cue[], padding: number) {
  const speech = cues.filter(cue => cue.start < range.end && cue.end > range.start && cue.text.trim())
    .sort((a, b) => a.start - b.start)
  const removals: ClipRange[] = []
  for (const silence of silences) {
    let start = Math.max(range.start, silence.start) + padding
    const end = Math.min(range.end, silence.end) - padding
    for (const cue of speech) {
      if (cue.end <= start) continue
      if (cue.start >= end) break
      if (cue.start - padding - start >= .2) removals.push({ start, end: cue.start - padding })
      start = Math.max(start, cue.end + padding)
    }
    if (end - start >= .2) removals.push({ start, end })
  }
  return removals.slice(0, 100)
}

export function editedDuration(range: ClipRange, removals: ClipRange[]) {
  return range.end - range.start - removals.reduce((total, cut) => total + cut.end - cut.start, 0)
}

const sentenceEnd = /[.!?…][”"’']*$/u

function words(text: string) {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
}

function nearDuplicate(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return false
  const shared = [...a].filter(word => b.has(word)).length
  return shared / (a.size + b.size - shared) >= .82
}

export function recommendShorts(cues: Cue[], silences: ClipRange[], duration: number, silencePadding: number | null = pauseSettings.padding): Candidate[] {
  const speech = cues.filter(cue => cue.text.trim() && cue.start >= 0 && cue.end > cue.start && cue.start < duration)
    .sort((a, b) => a.start - b.start)
  const boundary = speech.map((cue, index) => {
    const next = speech[index + 1]
    if (!next) return 3
    const gap = next.start - cue.end
    if (gap < 0) return 0
    if (sentenceEnd.test(cue.text.trim())) return 3
    return gap >= .5 || (gap >= .15 && silences.some(silence => silence.start < next.start && silence.end > cue.end)) ? 2 : 0
  })
  const spokenPrefix = [0]
  for (const [index, cue] of speech.entries()) {
    spokenPrefix.push(spokenPrefix[index] + Math.max(0, cue.end - Math.max(cue.start, speech[index - 1]?.end ?? 0)))
  }
  const ranked: (Candidate & { rank: number; last: number })[] = []
  for (const [index, cue] of speech.entries()) {
    const entry = index ? boundary[index - 1] : 3
    if (!entry) continue
    const start = Math.max(0, cue.start - Math.min(.12, (cue.start - (speech[index - 1]?.end ?? 0)) / 2))
    const choices: typeof ranked = []
    for (let last = index; last < speech.length && last < index + 200; last++) {
      const tail = speech[last]
      if (tail.end - start > 60) break
      if (!boundary[last] || tail.end - start < 14.88) continue
      const gap = (speech[last + 1]?.start ?? duration) - tail.end
      const end = Math.min(duration, start + 60, tail.end + Math.min(.12, Math.max(0, gap / 2)))
      const length = end - start
      if (length < 15) continue
      const talking = Math.min(1, (spokenPrefix[last + 1] - spokenPrefix[index]) / length)
      if (talking < .37) continue
      const boundaries = entry + boundary[last]
      const targetDistance = Math.min(...[20, 30, 45, 58].map(target => Math.abs(length - target)))
      choices.push({ id: index, start, end, text: '', selected: true, boundaries, speech: talking, last,
        rank: boundaries * 10 + talking * 10 - targetDistance * .45 })
    }
    ranked.push(...choices.sort((a, b) => b.rank - a.rank || a.end - b.end).slice(0, 4))
  }
  ranked.sort((a, b) => b.rank - a.rank || a.start - b.start)
  const results: { candidate: Candidate; tokens: Set<string> }[] = []
  for (const item of ranked) {
    if (results.some(({ candidate }) => Math.min(candidate.end, item.end) - Math.max(candidate.start, item.start) >
        .12 * Math.min(candidate.end - candidate.start, item.end - item.start))) continue
    const text = speech.slice(item.id, item.last + 1).map(cue => cue.text.trim()).join(' ')
    const tokens = words(text)
    if (results.some(result => nearDuplicate(result.tokens, tokens))) continue
    if (silencePadding !== null && editedDuration(item, safePauses(item, silences, speech, silencePadding)) < 15) continue
    const { id, start, end, boundaries, speech: coverage, selected } = item
    results.push({ candidate: { id, start, end, boundaries, speech: coverage, selected, text: text.slice(0, 240) }, tokens })
    if (results.length === 3) break
  }
  return results.map(item => item.candidate)
}
