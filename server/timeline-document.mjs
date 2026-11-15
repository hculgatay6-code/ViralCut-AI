import { keyframeDocument, keyframeLimits } from './keyframes.mjs'

const kinds = ['video', 'audio', 'caption', 'text']
const frameRates = [24, 25, 30, 50, 60]
const idPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i
const between = (number, min, max) => Number.isFinite(number) && number >= min && number <= max

export const layerLimits = Object.freeze({ tracks: 24, clips: 500, video: 5, audio: 8, seconds: 86400 })

function requireValid(condition) {
  if (!condition) throw Error('badTimeline')
}

export function timelineDocument(value, hasMedia) {
  requireValid(value && frameRates.includes(value.fps) && Array.isArray(value.tracks) &&
    value.tracks.length <= layerLimits.tracks)
  const max = value.fps * layerLimits.seconds
  const ids = new Set()
  let count = 0
  let keyframes = 0
  function identifier(id) {
    requireValid(typeof id === 'string' && idPattern.test(id) && !ids.has(id))
    ids.add(id)
    return id
  }
  const tracks = value.tracks.map(track => {
    requireValid(track && kinds.includes(track.kind) && typeof track.name === 'string' &&
      track.name.trim() && track.name.length <= 60 && Array.isArray(track.clips))
    count += track.clips.length
    requireValid(count <= layerLimits.clips)
    const id = identifier(track.id)
    const { kind, name, locked, hidden, muted, solo, gain } = track
    requireValid([locked, hidden, muted, solo].every(flag => typeof flag === 'boolean') && between(gain, 0, 2))
    const clips = track.clips.map(clip => {
      requireValid(clip && [clip.at, clip.length].every(Number.isSafeInteger) &&
        clip.at >= 0 && clip.length >= 1 && clip.at + clip.length <= max)
      const animation = keyframeDocument(clip.animation, kind, clip.length)
      for (const points of Object.values(animation ?? {})) keyframes += points.length
      requireValid(keyframes <= keyframeLimits.project)
      const base = { id: identifier(clip.id), at: clip.at, length: clip.length, ...(animation ? { animation } : {}) }
      if (kind === 'caption' || kind === 'text') {
        requireValid(typeof clip.text === 'string' && clip.text.trim() && clip.text.length <= 500)
        return { ...base, text: clip.text }
      }
      requireValid(typeof clip.mediaId === 'string' && hasMedia(clip.mediaId, kind) &&
        Number.isSafeInteger(clip.inFrame) && clip.inFrame >= 0 && clip.inFrame + clip.length <= max)
      const source = { ...base, mediaId: clip.mediaId, inFrame: clip.inFrame }
      if (kind === 'audio') return source
      requireValid(between(clip.x, 0, 1) && between(clip.y, 0, 1) &&
        between(clip.scale, 0.1, 2) && between(clip.opacity, 0, 1))
      return { ...source, x: clip.x, y: clip.y, scale: clip.scale, opacity: clip.opacity }
    }).sort((a, b) => a.at - b.at)
    requireValid(clips.every((clip, i) => !i || clips[i - 1].at + clips[i - 1].length <= clip.at))
    return { id, kind, name, locked, hidden, muted, solo, gain, clips }
  })
  return { fps: value.fps, tracks }
}

export function remapTimeline(timeline, mediaIds) {
  return {
    ...timeline,
    tracks: timeline.tracks.map(track => ({
      ...track,
      clips: track.clips.map(clip => clip.mediaId ? { ...clip, mediaId: mediaIds.get(clip.mediaId) } : clip),
    })),
  }
}
