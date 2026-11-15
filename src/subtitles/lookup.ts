import type { Cue } from './model'

export function createCueLookup(cues: readonly Cue[]) {
  const sorted = cues.flatMap((cue, index) => cue.text.trim() ? [{ cue, index, maxEnd: cue.end }] : [])
    .sort((a, b) => a.cue.start - b.cue.start)
  for (let i = 1; i < sorted.length; i++) sorted[i].maxEnd = Math.max(sorted[i - 1].maxEnd, sorted[i].maxEnd)
  return (time: number) => {
    let first = 0, last = sorted.length
    while (first < last) {
      const middle = (first + last) >>> 1
      if (sorted[middle].cue.start <= time) first = middle + 1
      else last = middle
    }
    const active = []
    for (let i = first - 1; i >= 0 && sorted[i].maxEnd > time; i--) {
      if (sorted[i].cue.end > time) active.push(sorted[i])
    }
    return active.sort((a, b) => a.index - b.index).map(entry => entry.cue)
  }
}
