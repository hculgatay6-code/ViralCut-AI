import type { Candidate } from './autoShorts'
import type { StudioEffects } from './effects'
import { defaultAppearance } from '../subtitles/model.ts'
import type { Appearance, Cue } from '../subtitles/model'

export const captionStyles = ['auto', 'minimal', 'gaming', 'podcast', 'dynamic', 'cinematic', 'clean'] as const
export const colorStyles = ['auto', 'natural', 'vivid', 'cinematic', 'gaming'] as const
export const intensities = ['off', 'low', 'balanced', 'high'] as const
export type StudioSettings = {
  captions: typeof captionStyles[number]; color: typeof colorStyles[number]; intensity: typeof intensities[number]
  camera: 'auto' | 'center' | 'contain'; target: number | null; musicLevel: number; noise: boolean
}

export const studioDefaults: StudioSettings = {
  captions: 'auto', color: 'auto', intensity: 'balanced', camera: 'auto', target: -16, musicLevel: .14, noise: false,
}

const looks: Record<Exclude<StudioSettings['captions'], 'auto'>, Partial<Appearance>> = {
  minimal: { size: 45, highlight: false, motion: 'none', outline: 2 },
  gaming: { size: 56, style: 'bold', motion: 'pop', highlightMode: 'word', highlightColor: '#ffdf72' },
  podcast: { size: 48, style: 'box', motion: 'fade', highlight: false },
  dynamic: { size: 54, motion: 'pop', highlightMode: 'karaoke' },
  cinematic: { size: 47, motion: 'fade', highlight: false, shadow: 2 },
  clean: { size: 49, motion: 'fade', highlightMode: 'word', outline: 3 },
}

export function cinematicLook(style: string, clip: Candidate, cues: Cue[], settings: StudioSettings) {
  const motion = clip.visual?.motion ?? 0
  const picture = clip.picture
  const automaticCaption = style === 'gaming' ? 'gaming' : style === 'podcast' ? 'podcast' : style === 'entertainment' ? 'dynamic' :
    style === 'vlog' ? 'cinematic' : style === 'education' ? 'minimal' : 'clean'
  const caption = { ...defaultAppearance, safe: true, ...looks[settings.captions === 'auto' ? automaticCaption : settings.captions] }
  const level = intensities.indexOf(settings.intensity)
  const contain = settings.camera === 'contain' || (settings.camera === 'auto' && (style === 'gaming' || picture?.wideFaces))
  const track = settings.camera === 'auto' && !contain ? clip.track : undefined
  const emphasis = level && !contain && !track?.some(point => Math.abs(point.x) > .09) && motion < 38 &&
    ['speech', 'podcast', 'education', 'entertainment', 'vlog'].includes(style) && cues.find(cue =>
      cue.start > clip.start + .4 && cue.start + 1.9 < clip.end && cue.end - cue.start >= 1.8 &&
      !picture?.cuts.some(cut => Math.abs(cut - cue.start) < 2))
  const grade = settings.color === 'auto' ? style === 'gaming' ? 'gaming' : style === 'entertainment' ? 'vivid' :
    style === 'vlog' ? 'cinematic' : 'natural' : settings.color
  const effects: StudioEffects = {
    noise: settings.noise && cues.length ? 4 : undefined,
    fadeIn: .14, fadeOut: .24,
    saturation: grade === 'vivid' ? 1.09 : grade === 'gaming' ? 1.05 : grade === 'cinematic' ? .95 : 1,
    contrast: (picture?.bright ?? 0) > .20 ? .96 : grade === 'cinematic' ? 1.04 : 1,
    brightness: picture && picture.light > 172 && picture.bright > .10 ? -.026 : picture && picture.light < 75 && picture.light > 25 ? .026 : 0,
    warmth: picture && Math.abs(picture.tint) > 13 && grade !== 'gaming' ? Math.max(-.045, Math.min(.045, -picture.tint / 780)) : 0,
    sharpness: grade === 'gaming' ? .12 : 0,
    zoom: emphasis ? { start: emphasis.start, end: emphasis.start + 1.75, from: 1, to: 1.02 + level * .02 } : undefined,
    zoomReturn: emphasis ? { start: emphasis.start + 1.75, end: Math.min(emphasis.end, emphasis.start + 3.5, clip.end - .08) } : undefined,
  }
  if (effects.zoomReturn && effects.zoomReturn.end - effects.zoomReturn.start < .10) effects.zoomReturn = undefined
  return { caption, effects, contain, track, edgeFade: level > 0 && style === 'podcast' && motion < 35 }
}
