import { ExportError } from './media.mjs'

export const platformProfiles = Object.freeze({
  youtube: { name: 'YouTube Shorts', min: 3, max: 180, bytes: 256e9, bitrate: 8000, fps: 30, title: 100, caption: 5000, captionUnit: 'bytes', safeY: 73 },
  tiktok: { name: 'TikTok', min: 3, max: 180, bytes: 4e9, bitrate: 6500, fps: 30, title: 100, caption: 2200, captionUnit: 'utf16', safeY: 69 },
  instagram: { name: 'Instagram Reels', min: 3, max: 180, bytes: 300e6, bitrate: 7000, fps: 30, title: 100, caption: 2200, captionUnit: 'utf16', safeY: 71 },
})

const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max

export function creatorProfile(id, raw = {}) {
  if (!Object.hasOwn(platformProfiles, id) || !raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).some(key => !['bitrate', 'fps', 'max'].includes(key))) throw new ExportError('badEdit', 400)
  const base = platformProfiles[id]
  const { bitrate = base.bitrate, fps = base.fps, max = base.max } = raw
  if (!Number.isInteger(bitrate) || !finite(bitrate, 2500, 12000) || ![24, 25, 30, 50, 60].includes(fps) ||
      !Number.isInteger(max) || !finite(max, 15, base.max)) throw new ExportError('badEdit', 400)
  return { ...base, fps, bitrate, max, width: 1080, height: 1920, video: 'h264', audio: 'aac', format: 'mp4' }
}

export function creatorMetadata(id, raw) {
  const limits = creatorProfile(id)
  if (!raw || typeof raw.title !== 'string' || typeof raw.description !== 'string' || !raw.title.trim() ||
      /[<>]/.test(raw.title + raw.description) || [...raw.title].length > limits.title) throw new ExportError('badMetadata', 400)
  const hashtags = raw.hashtags ?? []
  if (!Array.isArray(hashtags) || hashtags.length > 12 || hashtags.some(tag => typeof tag !== 'string' ||
    !/^#[\p{L}\p{N}_]{1,40}$/u.test(tag))) throw new ExportError('badMetadata', 400)
  const tags = raw.keywords ?? []
  if (!Array.isArray(tags) || tags.length > 12 || tags.some(tag => typeof tag !== 'string' || tag.length > 60 ||
    /[<>\r\n]/.test(tag))) throw new ExportError('badMetadata', 400)
  const description = raw.description.trim()
  const caption = [description, [...new Set(hashtags)].join(' ')].filter(Boolean).join('\n\n')
  if ((limits.captionUnit === 'bytes' ? Buffer.byteLength(caption) : caption.length) > limits.caption) throw new ExportError('badMetadata', 400)
  return { title: raw.title.trim(), description, hashtags: [...new Set(hashtags)], keywords: [...new Set(tags)], caption }
}

export function validatePlatformMedia(info, bytes, profile, hadAudio) {
  const video = info.streams.find(stream => stream.codec_type === 'video')
  const audio = info.streams.find(stream => stream.codec_type === 'audio')
  const [n, d] = (video?.avg_frame_rate ?? '').split('/').map(Number)
  return finite(bytes, 1, profile.bytes) && finite(Number(info.format.duration), profile.min - .05, profile.max + .05) &&
    video?.width === profile.width && video.height === profile.height && video.codec_name === profile.video &&
    Math.abs(n / d - profile.fps) <= .35 && (!audio || audio.codec_name === profile.audio) && (!hadAudio || Boolean(audio))
}
