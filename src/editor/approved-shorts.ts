import type { BatchRequest } from '../export/client'
import type { Project, ProjectClip, ProjectMedia } from '../project/model'
import type { ClipRange } from './model'
import type { Cue } from '../subtitles/model'
import { addLayerClips, emptyTrack, layerDuration, layerFromLegacy, mediaClip } from '../project/layer-model.ts'
import type { ClipSelection } from '../project/layer-model'

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

export function approveProfessionalPlan(project: Project, source: ProjectMedia, plan: ApprovedShorts, hasAudio = true): Project | undefined {
  const prepared = appendApprovedShorts({ ...project, clips: [] }, source, plan)
  if (!prepared) return
  const base = project.timeline ?? layerFromLegacy(project)
  const empty = !project.clips.length && !base.tracks.some(track => track.clips.length)
  const { fps } = base
  const video = emptyTrack('video', 'Auto · Video')
  const audio = emptyTrack('audio', 'Auto · Audio')
  const caption = emptyTrack('caption', 'Auto · CC')
  const additions: ClipSelection = []
  let at = layerDuration(base)
  for (const item of plan.items) {
    const { mode: _mode, ...reframe } = item.frame
    const spans = [...item.remove, { start: item.end, end: item.end }]
    let cursor = item.start
    for (const pause of spans) {
      const from = Math.max(0, Math.ceil(cursor * fps - 1e-7))
      const end = Math.floor(pause.start * fps + 1e-7)
      cursor = pause.end
      if (end <= from) continue
      const length = end - from
      const clip = mediaClip(source.id, 'video', at, from, length)
      const zoom = item.effects?.zoom
      if (zoom && zoom.end > zoom.start) {
        const curve = 'ease-in-out' as const
        const value = (frame: number) => {
          const progress = Math.min(1, Math.max(0, (frame / fps - zoom.start) / (zoom.end - zoom.start)))
          return zoom.from + (zoom.to - zoom.from) * (1 - Math.cos(Math.PI * progress)) / 2
        }
        const times = [0, Math.round(zoom.start * fps) - from, Math.round(zoom.end * fps) - from, length - 1]
        clip.animation = { scale: [...new Set(times)].filter(time => time >= 0 && time < length)
          .sort((a, b) => a - b).map(frame => ({ frame, value: value(from + frame), curve })) }
      }
      additions.push({ track: video, clip: { ...clip, reframe } })
      if (hasAudio) {
        const { noise, normalize, voice, fadeIn, fadeOut } = item.effects ?? {}
        const audioTreatment = { noise, normalize, voice, fadeIn: item.edgeFade ? (fadeIn ?? .25) : fadeIn,
          fadeOut: item.edgeFade ? (fadeOut ?? .25) : fadeOut }
        additions.push({ track: audio, clip: { ...mediaClip(source.id, 'audio', at, from, length),
          ...(Object.values(audioTreatment).some(Boolean) ? { audioTreatment } : {}) } })
      }
      let free = at
      const rows = [...(item.overlay?.cues ?? [])].sort((a, b) => a.start - b.start)
      for (const cue of rows) {
        const begin = Math.max(free, at + Math.round(cue.start * fps) - from)
        const finish = Math.min(at + length, at + Math.round(cue.end * fps) - from)
        if (finish <= begin || !cue.text.trim()) continue
        additions.push({ track: caption, clip: { id: crypto.randomUUID(), at: begin, length: finish - begin, text: cue.text } })
        free = finish
        if (additions.length > 500) return
      }
      at += length
    }
  }
  if (!additions.length) return
  const used = new Set(additions.map(entry => entry.track.id))
  const tracks = [...(empty ? [] : base.tracks), ...[video, audio, caption].filter(track => used.has(track.id))]
  if (tracks.length > 24) return
  const timeline = addLayerClips({ fps, tracks }, additions)
  if (!timeline) return
  const first = plan.items[0]
  return { ...project, version: 4, timeline, media: prepared.media,
    ...(empty ? { frame: { mode: first.frame.mode, zoom: 1, x: 0, y: 0 },
      appearance: first.overlay?.appearance ?? project.appearance, encoder: plan.encoder,
      profile: { ...project.profile, resolution: plan.resolution }, burn: used.has(caption.id) } : {}) }
}
