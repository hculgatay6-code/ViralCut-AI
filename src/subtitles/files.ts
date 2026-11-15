import { stylePresets } from './model'
import type { Appearance, Cue } from './model'
import { timecode } from '../editor/model'

export function subtitleFile(cues: Cue[], format: 'srt' | 'vtt') {
  const header = format === 'vtt' ? 'WEBVTT\n\n' : ''
  const time = (value: number) => format === 'srt' ? timecode(value).replace('.', ',') : timecode(value)
  return header + [...cues].sort((a, b) => a.start - b.start).map((cue, index) =>
    (format === 'srt' ? String(index + 1) + '\n' : '') + time(cue.start) + ' --> ' + time(cue.end) + '\n' +
    cue.text.trim().replaceAll('\r', '').replaceAll('-->', '→').replace(/\n\s*\n/g, '\n')
      .replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!)
  ).join('\n\n') + '\n'
}

export function updateStyle(appearance: Appearance, style: Appearance['style']): Appearance {
  return { ...appearance, ...stylePresets[style], style }
}
