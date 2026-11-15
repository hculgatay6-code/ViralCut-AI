import { editedDuration, safePauses } from './autoShorts.ts'
import type { Candidate } from './autoShorts'
import type { ShortsAnalysis } from '../export/client'
import type { ClipRange } from './model'
import { cinematicLook, studioDefaults } from './cinematic.ts'
import type { StudioSettings } from './cinematic'
import type { Frame } from './shorts'

export const profiles = ['auto', 'gaming', 'podcast', 'speech', 'education', 'entertainment', 'vlog', 'general'] as const
export type DirectorProfile = typeof profiles[number]

export function createDirectorPlan(analysis: ShortsAnalysis, count: number, profile: DirectorProfile, settings: StudioSettings = studioDefaults) {
  const candidates = analysis.selection?.candidates ?? []
  const chosen: Candidate[] = []
  const cap = count || 5
  function vocabulary(text: string) {
    return new Set(text.toLocaleLowerCase('tr').match(/[\p{L}\p{N}]{4,}/gu) ?? [])
  }
  for (const clip of [...candidates].sort((a, b) => (b.evaluation?.score ?? 0) - (a.evaluation?.score ?? 0) || a.start - b.start)) {
    if ((clip.evaluation?.score ?? 0) < 45) continue
    const words = vocabulary(clip.text)
    if (chosen.some(other => {
      if (Math.min(other.end, clip.end) - Math.max(other.start, clip.start) > .14 * Math.min(other.end - other.start, clip.end - clip.start)) return true
      const existing = vocabulary(other.text)
      const shared = [...words].filter(word => existing.has(word)).length
      if (shared >= 5 && shared / (words.size + existing.size - shared) >= .79) return true
      return !words.size && !existing.size && clip.visual && other.visual &&
        clip.visual.objects.length > 0 && clip.visual.objects.slice().sort().join() === other.visual.objects.slice().sort().join() &&
        Math.abs(clip.visual.motion - other.visual.motion) < 4 && Math.abs(clip.visual.events - other.visual.events) < 2
    })) continue
    chosen.push(clip)
    if (chosen.length === cap) break
  }
  return chosen.sort((a, b) => a.start - b.start).map(clip => {
    const cues = analysis.cues.filter(cue => cue.start < clip.end && cue.end > clip.start)
    const motion = clip.visual?.motion ?? 0
    const style = profile === 'auto' ? cues.length ? motion < 15 && clip.visual?.objects.includes('face') ? 'podcast' :
      motion > 46 ? 'vlog' : 'speech' : 'general' : profile
    const look = cinematicLook(style, clip, cues, settings)
    const remove: ClipRange[] = []
    if (cues.length && analysis.hasAudio !== false && style !== 'gaming') {
      for (const span of safePauses(clip, analysis.silences, cues, .24)) {
        if (span.start - clip.start < .25 || clip.end - span.end < .25 || span.end - span.start < .28) continue
        if (editedDuration(clip, [...remove, span]) >= Math.max(15, (clip.end - clip.start) * .8)) remove.push(span)
      }
    }
    const frame: Frame = { mode: 'vertical', x: 0, y: 0, zoom: 1, track: look.track, fit: look.contain ? 'contain' : undefined }
    const mastering = settings.target === null ? undefined : { target: settings.target, musicLevel: settings.musicLevel }
    return { clip, style, selected: true, item: { start: clip.start, end: clip.end, remove, frame,
      overlay: cues.length ? { appearance: look.caption, cues } : undefined, effects: look.effects, edgeFade: look.edgeFade, mastering } }
  })
}

export type PlannedShort = ReturnType<typeof createDirectorPlan>[number]
