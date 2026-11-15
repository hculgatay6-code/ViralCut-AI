import type { ClipRange } from '../editor/model'
import type { Cue } from '../subtitles/model'

export const sizes = { vertical: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080] } as const
export type FrameMode = keyof typeof sizes
export interface Frame { mode: FrameMode; zoom: number; x: number; y: number; fit?: 'contain'; track?: { time: number; x: number }[] }
export function frameX(frame: Frame, time: number) {
  const points = frame.track
  if (!points?.length) return frame.x
  const index = points.findIndex(point => point.time > time)
  if (index < 0) return points.at(-1)!.x
  if (!index) return points[0].x
  const a = points[index - 1], b = points[index]
  return a.x + (b.x - a.x) * (time - a.time) / (b.time - a.time)
}
export interface Edit { frame?: Frame; remove: ClipRange[]; encoder: 'auto' | 'cpu' }
export const defaultFrame: Frame = { mode: 'vertical', zoom: 1, x: 0, y: 0 }

const ending = /[.!?…][”"’']*$/u

export function suggestClips(cues: Cue[], silences: ClipRange[], target: number, duration: number) {
  const speech = cues.filter(cue => cue.text.trim() && cue.end > cue.start)
    .sort((a, b) => a.start - b.start)
  const ends = speech.map((cue, index) => {
    const next = speech[index + 1]
    const gap = (next?.start ?? duration) - cue.end
    const quiet = gap > 0.12 && silences.some(silence => silence.start < (next?.start ?? duration) && silence.end > cue.end)
    return gap >= 0 && (ending.test(cue.text.trim()) || gap >= 0.48 || quiet || !next)
      ? { index, time: Math.min(duration, cue.end + Math.min(0.12, Math.max(0, gap / 2))), gap } : null
  }).filter(end => end !== null)
  const boundaries = new Set(ends.map(end => end.index))
  const candidates: (ClipRange & { distance: number; text: string })[] = []
  let endOffset = 0
  for (let index = 0; index < speech.length; index++) {
    const cue = speech[index]
    const previous = speech[index - 1]
    if (previous && (!boundaries.has(index - 1) || previous.end > cue.start)) continue
    const start = Math.max(0, cue.start - Math.min(0.12, (cue.start - (previous?.end ?? 0)) / 2))
    while (endOffset < ends.length && ends[endOffset].time < start + target * 0.7) endOffset++
    let selected = ends[endOffset]
    if (!selected || selected.index < index || selected.time - start > target * 1.3) continue
    for (let choice = endOffset + 1; choice < ends.length && ends[choice].time - start <= target * 1.3; choice++) {
      const candidate = ends[choice]
      if (Math.abs(candidate.time - start - target) >= Math.abs(selected.time - start - target)) break
      selected = candidate
    }
    candidates.push({ start, end: selected.time, distance: Math.abs(selected.time - start - target),
      text: speech.slice(index, selected.index + 1).map(item => item.text.trim()).join(' ').slice(0, 135) })
  }
  candidates.sort((a, b) => a.distance - b.distance || a.start - b.start)
  const results: typeof candidates = []
  for (const candidate of candidates) {
    if (results.some(result => candidate.start < result.end && candidate.end > result.start)) continue
    results.push(candidate)
    if (results.length === 5) break
  }
  return results
}
