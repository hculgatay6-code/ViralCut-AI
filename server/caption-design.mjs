export const motions = ['none', 'fade', 'pop', 'drop', 'bounce']
export const highlights = ['word', 'karaoke', 'speech', 'keywords']

export function hasReliableWords(cue) {
  const words = cue.words
  if (!words?.length || words.map(word => word.text).join('') !== cue.text) return false
  let previous = cue.start
  for (const word of words) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < previous ||
        word.start - previous > 1.2 || word.end - word.start < .02 || word.end > cue.end) return false
    previous = word.end
  }
  return cue.end - previous <= 1.2
}

export function captionMotion(cue, design, time, timed) {
  const mode = design.highlightMode && design.highlight && !timed ? 'fade' : design.motion
  const length = cue.end - cue.start
  const window = Math.min(length / 2, .42 / (design.speed ?? 1))
  const entry = Math.max(0, Math.min(1, (time - cue.start) / window))
  const exit = Math.max(0, Math.min(1, (cue.end - time) / window))
  const ease = 1 - (1 - entry) ** 3
  const scale = mode === 'pop' ? .72 + .28 * ease
    : mode === 'bounce' ? 1 - .29 * Math.exp(-3.5 * entry) * Math.cos(entry * 10) * (1 - entry) : 1
  return { window, scale, offset: mode === 'drop' ? -85 * (1 - ease) : 0,
    opacity: mode === 'fade' ? Math.min(entry, exit) : 1 }
}

export function captionParts(cue, design, time, timed) {
  if (!design.highlight || !timed) return [{ text: cue.text }]
  const words = cue.words ?? []
  return words.map((word, index) => {
    const active = time >= word.start && time < word.end
    const meaningful = /\d/.test(word.text) || word.text.replace(/[^\p{L}]/gu, '').length >= 7
    const mode = design.highlightMode
    return { text: word.text, color: mode === 'karaoke' ? (time >= word.start ? design.highlightColor : undefined)
      : mode === 'keywords' ? (active && meaningful ? design.highlightColor : undefined)
        : active ? (mode === 'speech' && index % 2 ? design.secondaryColor ?? design.highlightColor : design.highlightColor) : undefined }
  })
}

export function captionY(design) {
  return design.y ?? ({ top: 17, middle: 50, bottom: 77 })[design.position]
}
