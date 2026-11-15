import { ExportError } from './media.mjs'
import { captionMotion, captionParts, captionY, hasReliableWords, highlights, motions } from './caption-design.mjs'

const fonts = { arial: 'Arial', segoe: 'Segoe UI', verdana: 'Verdana' }
const positions = { top: 8, middle: 5, bottom: 2 }
const styles = { classic: [0, 1, 3], bold: [-1, 1, 4], box: [-1, 3, 5] }
const color = /^#[a-f\d]{6}$/i

function inRange(start, end, limit) {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= limit
}

export function validateOverlay(overlay) {
  const { cues, appearance } = overlay ?? {}
  const { font, position, style, size, textColor, highlightColor, backgroundColor, highlight } = appearance ?? {}
  if (!Object.hasOwn(fonts, font) || !Object.hasOwn(positions, position) || !Object.hasOwn(styles, style) ||
      !Number.isInteger(size) || size < 22 || size > 100 || typeof highlight !== 'boolean' ||
      ![textColor, highlightColor, backgroundColor].every(value => typeof value === 'string' && color.test(value)) ||
      !Array.isArray(cues) || !cues.length || cues.length > 10000) throw new ExportError('badSubtitles', 400)
  for (const [key, min, max] of [['speed', .5, 2], ['outline', 0, 10], ['shadow', 0, 8], ['y', 12, 83]]) {
    const value = appearance[key]
    if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) throw new ExportError('badSubtitles', 400)
  }
  if ((appearance.motion !== undefined && !motions.includes(appearance.motion)) ||
      (appearance.highlightMode !== undefined && !highlights.includes(appearance.highlightMode)) ||
      (appearance.safe !== undefined && typeof appearance.safe !== 'boolean') ||
      [appearance.secondaryColor, appearance.outlineColor].some(value => value !== undefined && (typeof value !== 'string' || !color.test(value)))) {
    throw new ExportError('badSubtitles', 400)
  }
  for (const cue of cues) {
    const { start, end, text, words } = cue ?? {}
    if (!inRange(start, end, 864000) || typeof text !== 'string' || !text.trim() || text.length > 500 ||
        (words !== undefined && (!Array.isArray(words) || words.length > 120))) throw new ExportError('badSubtitles', 400)
    let previous = start
    for (const word of words ?? []) {
      if (!inRange(word?.start, word?.end, end) || word.start < previous ||
          typeof word.text !== 'string' || !word.text || word.text.length > 160) throw new ExportError('badSubtitles', 400)
      previous = word.end
    }
    if (words?.length && words.map(word => word.text).join('') !== text) throw new ExportError('badSubtitles', 400)
  }
  return { cues, appearance }
}

function assColor(value) {
  return value.slice(5, 7) + value.slice(3, 5) + value.slice(1, 3)
}

function assText(text) {
  return text.replaceAll('\\', '＼').replaceAll('{', '｛').replaceAll('}', '｝').replace(/\r\n?|\n/g, '\\N')
}

function timestamp(ticks) {
  return Math.floor(ticks / 360000) + ':' +
    [Math.floor(ticks / 6000) % 60, Math.floor(ticks / 100) % 60].map(n => String(n).padStart(2, '0')).join(':') +
    '.' + String(ticks % 100).padStart(2, '0')
}

export function buildAss({ cues, appearance }, start, end, frame, visibleFrom = start) {
  const [bold, border, outline] = styles[appearance.style]
  const primary = assColor(appearance.textColor)
  const accent = assColor(appearance.highlightColor)
  const background = assColor(appearance.backgroundColor)
  const outlineColor = assColor(appearance.outlineColor ?? appearance.backgroundColor)
  const width = frame?.mode === 'vertical' ? 608 : frame?.mode === 'square' ? 1080 : 1920
  const safe = appearance.safe || appearance.y !== undefined
  const margin = safe ? Math.round(width * .12) : 90
  const events = []
  for (const cue of cues) {
    let cursor = Math.round((Math.max(cue.start, visibleFrom) - start) * 100)
    const last = Math.round((Math.min(cue.end, end) - start) * 100)
    if (cursor >= last) continue
    function event(until, text) {
      const stop = Math.min(last, until)
      if (stop <= cursor) return
      events.push('Dialogue: 0,' + timestamp(cursor) + ',' + timestamp(stop) + ',Caption,,0,0,0,,' + text)
      cursor = stop
    }
    const plain = assText(cue.text)
    if (safe || appearance.motion !== undefined || appearance.highlightMode !== undefined) {
      const timed = hasReliableWords(cue)
      const first = cursor
      const edges = new Set([first, last])
      function edge(time) {
        const tick = Math.round((time - start) * 100)
        if (tick > first && tick < last) edges.add(tick)
      }
      if (timed && appearance.highlight) for (const word of cue.words) { edge(word.start); edge(word.end) }
      const { window } = captionMotion(cue, appearance, cue.start, timed)
      const fade = appearance.motion === 'fade' || (appearance.highlightMode && appearance.highlight && !timed)
      if (fade || (appearance.motion && appearance.motion !== 'none')) {
        for (let dt = 0; dt < window; dt += .03) { edge(cue.start + dt); if (fade) edge(cue.end - dt) }
        edge(cue.start + window)
        if (fade) edge(cue.end - window)
      }
      const baseY = safe ? captionY(appearance) * 10.8 : ({ top: 100, middle: 540, bottom: 970 })[appearance.position]
      for (const until of [...edges].sort((a, b) => a - b).slice(1)) {
        const time = start + (cursor + until) / 200
        const state = captionMotion(cue, appearance, time, timed)
        const alpha = Math.round((1 - state.opacity) * 255).toString(16).padStart(2, '0')
        const scale = (100 * state.scale).toFixed(2)
        const tags = `{\\an5\\pos(${width / 2},${Math.round(baseY + state.offset)})\\fscx${scale}\\fscy${scale}\\alpha&H${alpha}&}`
        const parts = captionParts(cue, appearance, time, timed).map(part => part.color
          ? '{\\1c&H' + assColor(part.color) + '&}' + assText(part.text) + '{\\1c&H' + primary + '&}'
          : assText(part.text))
        event(until, tags + parts.join(''))
      }
      continue
    }
    if (appearance.highlight) {
      const words = cue.words ?? []
      for (let index = 0; index < words.length; index++) {
        const word = words[index]
        if (word.end <= start || word.start >= end) continue
        event(Math.round((word.start - start) * 100), plain)
        const highlighted = words.map((item, i) => i === index
          ? '{\\1c&H' + accent + '&}' + assText(item.text) + '{\\1c&H' + primary + '&}'
          : assText(item.text)).join('')
        event(Math.round((word.end - start) * 100), highlighted)
      }
    }
    event(last, plain)
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${fonts[appearance.font]},${appearance.size},&H00${primary},&H00${accent},&H00${border === 3 ? background : outlineColor},&H00${background},${bold},0,0,0,100,100,0,0,${border},${appearance.outline ?? outline},${appearance.shadow ?? 1},${positions[appearance.position]},${margin},${margin},68,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`
}
