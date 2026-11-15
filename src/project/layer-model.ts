import type { Project } from './model'

export type TrackKind = 'video' | 'audio' | 'caption' | 'text'
export type TimelineClip = { id: string; at: number; length: number; mediaId?: string; inFrame?: number
  text?: string; x?: number; y?: number; scale?: number; opacity?: number }
export type Track = { id: string; kind: TrackKind; name: string; locked: boolean; hidden: boolean
  muted: boolean; solo: boolean; gain: number; clips: TimelineClip[] }
export type LayerTimeline = { fps: Project['profile']['fps']; tracks: Track[] }
export type ClipSelection = { track: Track; clip: TimelineClip }[]

const limit = 500
export function emptyTrack(kind: TrackKind, name: string): Track {
  return { id: crypto.randomUUID(), kind, name, locked: false, hidden: false, muted: false, solo: false, gain: 1, clips: [] }
}

export function layerDuration(timeline: LayerTimeline) {
  return Math.max(0, ...timeline.tracks.flatMap(track => track.clips.map(clip => clip.at + clip.length)))
}

export function mediaClip(mediaId: string, kind: TrackKind, at: number, inFrame: number, length: number): TimelineClip {
  return { id: crypto.randomUUID(), mediaId, at, inFrame, length,
    ...(kind === 'video' ? { x: .5, y: .5, scale: 1, opacity: 1 } : {}) }
}

export function layerFromLegacy(project: Project): LayerTimeline {
  const { fps } = project.profile
  const tracks = [emptyTrack('video', 'V1'), emptyTrack('audio', 'A1'), emptyTrack('caption', 'CC1')]
  const cueSources = new Map(project.media.map(source => [source.id, source.cues]))
  let at = 0
  let items = 0
  for (const clip of project.clips) {
    const from = Math.round(clip.start * fps)
    const length = Math.floor(clip.end * fps + 0.001) - from
    if (length < 1) continue
    if (from + length > fps * 86400 || at + length > fps * 86400 || items + 1 + Number(!clip.muteAudio) > limit) break
    tracks[0].clips.push(mediaClip(clip.mediaId, 'video', at, from, length))
    items++
    if (!clip.muteAudio) {
      tracks[1].clips.push(mediaClip(clip.mediaId, 'audio', at, from, length))
      items++
    }
    let free = at
    if (project.burn) for (const cue of cueSources.get(clip.mediaId) ?? []) {
      const begin = Math.max(free, at + Math.round(cue.start * fps) - from)
      const end = Math.min(at + length, at + Math.round(cue.end * fps) - from)
      if (begin >= end || !cue.text.trim() || items >= limit) continue
      tracks[2].clips.push({ id: crypto.randomUUID(), text: cue.text, at: begin, length: end - begin })
      items++
      free = end
    }
    at += length
  }
  return { fps, tracks }
}

export function updateTrack(timeline: LayerTimeline, id: string, transform: (track: Track) => Track) {
  return { ...timeline, tracks: timeline.tracks.map(track => track.id === id ? transform(track) : track) }
}

export function selectedClips(timeline: LayerTimeline, ids: ReadonlySet<string>): ClipSelection {
  return timeline.tracks.flatMap(track => track.clips.filter(clip => ids.has(clip.id)).map(clip => ({ track, clip })))
}

function withClips(timeline: LayerTimeline, changes: Map<string, TimelineClip[]>): LayerTimeline | null {
  const tracks = timeline.tracks.map(track => {
    const clips = changes.get(track.id)
    return clips ? { ...track, clips: [...clips].sort((a, b) => a.at - b.at) } : track
  })
  if (tracks.reduce((sum, track) => sum + track.clips.length, 0) > limit) return null
  for (const track of tracks) {
    if (!changes.has(track.id)) continue
    if (track.locked || track.clips.some((clip, i) =>
      ![clip.at, clip.length, clip.inFrame ?? 0].every(Number.isSafeInteger) || clip.at < 0 ||
      clip.length < 1 || (clip.inFrame ?? 0) < 0 || Math.max(clip.at, clip.inFrame ?? 0) + clip.length > timeline.fps * 86400 ||
      (i > 0 && track.clips[i - 1].at + track.clips[i - 1].length > clip.at))) return null
  }
  return { ...timeline, tracks }
}

export function snapFrame(timeline: LayerTimeline, at: number, playhead: number, threshold: number, excluded = new Set<string>()) {
  let best = Math.round(at)
  let distance = threshold + 0.001
  function consider(candidate: number) {
    const next = Math.abs(candidate - at)
    if (next < distance) { best = candidate; distance = next }
  }
  consider(0)
  consider(playhead)
  for (const track of timeline.tracks) for (const clip of track.clips) {
    if (excluded.has(clip.id)) continue
    consider(clip.at)
    consider(clip.at + clip.length)
  }
  return Math.max(0, best)
}

export function moveSelection(timeline: LayerTimeline, ids: ReadonlySet<string>, delta: number, targetId?: string) {
  const selected = selectedClips(timeline, ids)
  const target = timeline.tracks.find(track => track.id === targetId)
  const sourceId = selected[0]?.track.id
  if (!selected.length || selected.some(({ track }) => track.locked) ||
      (target && selected.some(({ track }) => track.kind !== target.kind || track.id !== sourceId))) return null
  const changes = new Map<string, TimelineClip[]>()
  for (const { track } of selected) if (!changes.has(track.id)) changes.set(track.id, track.clips.filter(clip => !ids.has(clip.id)))
  for (const { track, clip } of selected) {
    const destination = target ?? track
    const clips = changes.get(destination.id) ?? [...destination.clips]
    clips.push({ ...clip, at: clip.at + delta })
    changes.set(destination.id, clips)
  }
  return withClips(timeline, changes)
}

export function addLayerClips(timeline: LayerTimeline, selection: ClipSelection) {
  const changes = new Map<string, TimelineClip[]>()
  for (const { track, clip } of selection) {
    const destination = timeline.tracks.find(item => item.id === track.id)
    if (!destination || destination.kind !== track.kind) return null
    const clips = changes.get(track.id) ?? [...destination.clips]
    clips.push(clip)
    changes.set(track.id, clips)
  }
  return withClips(timeline, changes)
}

export function putLayerClip(timeline: LayerTimeline, trackId: string, clip: TimelineClip, ripple = false) {
  const track = timeline.tracks.find(item => item.id === trackId)
  if (!track) return null
  const old = track.clips.find(item => item.id === clip.id)
  const delta = old ? clip.at + clip.length - old.at - old.length : 0
  const clips = track.clips.filter(item => item.id !== clip.id).map(item =>
    ripple && old && item.at >= old.at + old.length ? { ...item, at: item.at + delta } : item)
  return withClips(timeline, new Map([[trackId, [...clips, clip]]]))
}

export function deleteSelection(timeline: LayerTimeline, ids: ReadonlySet<string>, ripple: boolean) {
  const changes = new Map<string, TimelineClip[]>()
  for (const track of timeline.tracks) {
    if (!track.clips.some(clip => ids.has(clip.id))) continue
    let removed = 0
    const clips = track.clips.flatMap(clip => {
      if (ids.has(clip.id)) { removed += clip.length; return [] }
      return [ripple && removed ? { ...clip, at: clip.at - removed } : clip]
    })
    changes.set(track.id, clips)
  }
  return changes.size ? withClips(timeline, changes) : null
}

export function splitLayerClip(timeline: LayerTimeline, track: Track, clip: TimelineClip, at: number) {
  const length = at - clip.at
  if (length <= 0 || length >= clip.length) return null
  const right = { ...clip, id: crypto.randomUUID(), at, length: clip.length - length,
    ...(clip.inFrame === undefined ? {} : { inFrame: clip.inFrame + length }) }
  return withClips(timeline, new Map([[track.id, track.clips.flatMap(item =>
    item.id === clip.id ? [{ ...clip, length }, right] : [item])]]))
}

export function mergeLayerClip(timeline: LayerTimeline, track: Track, clip: TimelineClip) {
  const next = track.clips.find(item => item.at === clip.at + clip.length)
  if (!next || next.mediaId !== clip.mediaId || next.text !== clip.text || next.scale !== clip.scale ||
      next.x !== clip.x || next.y !== clip.y || next.opacity !== clip.opacity ||
      (clip.inFrame !== undefined && next.inFrame !== clip.inFrame + clip.length)) return null
  return withClips(timeline, new Map([[track.id, track.clips.filter(item => item.id !== next.id).map(item =>
    item.id === clip.id ? { ...clip, length: clip.length + next.length } : item)]]))
}

export function changeGap(timeline: LayerTimeline, track: Track, at: number, delta: number) {
  const edge = track.clips.filter(clip => clip.at < at).at(-1)
  const next = track.clips.find(clip => clip.at >= at)
  if (!next || (edge && edge.at + edge.length > at)) return null
  const shift = delta < 0 ? (edge ? edge.at + edge.length : 0) - next.at : delta
  if (!shift) return null
  return withClips(timeline, new Map([[track.id, track.clips.map(clip =>
    clip.at >= at ? { ...clip, at: clip.at + shift } : clip)]]))
}

export function frameCode(frame: number, fps: number) {
  return [Math.floor(frame / fps / 3600), Math.floor(frame / fps / 60) % 60,
    Math.floor(frame / fps) % 60, frame % fps].map(value => String(value).padStart(2, '0')).join(':')
}
