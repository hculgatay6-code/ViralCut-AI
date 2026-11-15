import type { Cue } from '../subtitles/model'
import type { ClipRange } from './model'

export interface StudioEffects {
  brightness?: number; contrast?: number; saturation?: number; sharpness?: number; warmth?: number
  noise?: number; normalize?: boolean; voice?: boolean; fadeIn?: number; fadeOut?: number
  zoom?: ClipRange & { from: number; to: number }
  zoomReturn?: ClipRange
}
export type StudioTransition = { kind: 'fade' | 'dissolve' | 'slideleft'; duration: number }

export function zoomAt(zoom: StudioEffects['zoom'], time: number, retreat?: ClipRange) {
  if (!zoom) return 1
  const progress = Math.max(0, Math.min(1, (time - zoom.start) / (zoom.end - zoom.start)))
  const back = retreat ? Math.max(0, Math.min(1, (time - retreat.start) / (retreat.end - retreat.start))) : 0
  return zoom.from + (zoom.to - zoom.from) * (Math.cos(Math.PI * back) - Math.cos(Math.PI * progress)) / 2
}

export function suggestZoom(cues: Cue[], range: ClipRange): StudioEffects['zoom'] {
  const cue = cues.find(item => item.text.trim() && item.start >= range.start && item.end <= range.end && item.end - item.start >= .75)
  return cue ? { start: cue.start, end: Math.min(cue.end, cue.start + 2), from: 1, to: 1.14 } : undefined
}
