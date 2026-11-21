import type { BatchRequest } from '../export/client'
import type { Project, ProjectClip, ProjectMedia } from '../project/model'
import type { ClipRange } from './model'
import type { Cue } from '../subtitles/model'

export type ApprovedShorts = Pick<BatchRequest, 'items' | 'resolution' | 'encoder'>

export function speechCutInside(range: ClipRange, cues: Cue[]) {
  return cues.some(cue => cue.text.trim() && [range.start, range.end].some(time => time > cue.start + .08 && time < cue.end - .08))
}

export function appendApprovedShorts(project: Project, source: ProjectMedia, plan: ApprovedShorts): Project | undefined {
  const existing = project.media.find(item => item.id === source.id)
  if (source.missing || source.audioOnly || existing?.missing || !plan.items.length || plan.items.length > 10 ||
      (!existing && project.media.length >= 100)) return
  const additions: ProjectClip[] = []
  const subtitles = new Map((existing?.cues ?? []).map(cue => [cue.start, cue]))
  for (const item of plan.items) {
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end > 864000 ||
        item.end <= item.start || item.remove.length > 100) return
    let start = item.start
    const effects = item.edgeFade ? { ...item.effects, fadeIn: item.effects?.fadeIn ?? .25, fadeOut: item.effects?.fadeOut ?? .25 } : item.effects
    for (const pause of [...item.remove].sort((a, b) => a.start - b.start)) {
      if (!Number.isFinite(pause.start) || !Number.isFinite(pause.end) || pause.end <= pause.start ||
          pause.start < start || pause.end > item.end) return
      if (pause.start - start >= .001) additions.push({ id: crypto.randomUUID(), mediaId: source.id, start, end: pause.start, effects })
      start = pause.end
    }
    if (item.end - start >= .001) additions.push({ id: crypto.randomUUID(), mediaId: source.id, start, end: item.end, effects })
    for (const cue of item.overlay?.cues ?? []) if (!subtitles.has(cue.start)) subtitles.set(cue.start, cue)
  }
  if (!additions.length || project.clips.length + additions.length > 500 || subtitles.size > 10000) return
  const media = { ...(existing ?? source), cues: [...subtitles.values()].sort((a, b) => a.start - b.start) }
  const first = plan.items[0]
  const empty = !project.clips.length && !project.timeline?.tracks.some(track => track.clips.length)
  return {
    ...project,
    media: existing ? project.media.map(item => item.id === source.id ? media : item) : [...project.media, media],
    clips: [...project.clips, ...additions],
    ...(empty ? {
      frame: plan.items.length === 1 ? first.frame : { ...first.frame, track: undefined },
      burn: plan.items.some(item => !!item.overlay),
      appearance: first.overlay?.appearance ?? project.appearance,
      profile: { ...project.profile, resolution: plan.resolution },
      mastering: first.mastering,
      encoder: plan.encoder,
    } : {}),
  }
}
