import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { validateOverlay } from '../server/ass.mjs'
import { validateEdit, validateProfile } from '../server/shorts.mjs'
import { validateEffects, validateTransition } from '../server/effects.mjs'
import { studioAudioSettings } from '../server/studio-audio.mjs'

import { remapTimeline, timelineDocument } from '../server/timeline-document.mjs'

const maxBytes = 8 * 1024 * 1024
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i
const mediaTypes = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' }
const mediaFormat = path => mediaTypes[extname(path).toLowerCase()]
export function localPath(path) {
  // Restrict project links to regular local drive paths (no UNC, devices, or alternate streams).
  // oxlint-disable-next-line no-control-regex -- Reject control characters in a Windows path.
  const drivePath = /^[a-z]:[\\/][^:\u0000-\u001f]*$/i
  return typeof path === 'string' && path.length < 32767 && isAbsolute(path) && drivePath.test(path)
}
function requireValid(condition) {
  if (!condition) throw Error('badProject')
}

export function projectDocument(data) {
  requireValid([1, 2, 3].includes(data?.version) && Array.isArray(data.media) && data.media.length <= 100 &&
    Array.isArray(data.clips) && data.clips.length <= 500)
  const ids = new Set()
  const audio = new Set()
  const media = data.media.map(item => {
    requireValid(item && typeof item.id === 'string' && uuid.test(item.id) && !ids.has(item.id) &&
      localPath(item.path) && mediaFormat(item.path) && Number.isSafeInteger(item.size) && item.size > 0 &&
      typeof item.fingerprint === 'string' && /^[a-f\d]{64}$/.test(item.fingerprint))
    ids.add(item.id)
    if (mediaFormat(item.path).startsWith('audio/')) audio.add(item.id)
    requireValid(Array.isArray(item.cues) && item.cues.length <= 10000)
    const checked = item.cues.map(cue => {
      const blank = typeof cue?.text === 'string' && !cue.text.trim() && cue.text.length <= 500 && cue.words === undefined
      return blank ? { ...cue, text: 'x' } : cue
    })
    if (checked.length) validateOverlay({ cues: checked, appearance: data.appearance })
    return { id: item.id, path: item.path, size: item.size, fingerprint: item.fingerprint, cues: item.cues }
  })
  const appearance = validateOverlay({ cues: [{ start: 0, end: 1, text: 'x' }], appearance: data.appearance }).appearance
  const clipIds = new Set()
  const clips = data.clips.map(clip => {
    requireValid(clip && uuid.test(clip.id) && !clipIds.has(clip.id) && ids.has(clip.mediaId) && !audio.has(clip.mediaId) &&
      Number.isFinite(clip.start) && Number.isFinite(clip.end) && clip.start >= 0 &&
      clip.end - clip.start >= 0.001 && clip.end <= 864000)
    clipIds.add(clip.id)
    requireValid(clip.muteAudio === undefined || typeof clip.muteAudio === 'boolean')
    try {
      return { id: clip.id, mediaId: clip.mediaId, start: clip.start, end: clip.end, ...(clip.muteAudio ? { muteAudio: true } : {}),
        effects: validateEffects(clip.effects), transition: validateTransition(clip.transition) }
    } catch { throw Error('badProject') }
  })
  const frame = data.frame === undefined ? undefined : validateEdit({ frame: data.frame }).frame
  const profile = validateProfile(data.profile)
  requireValid(profile && ['auto', 'cpu'].includes(data.encoder))
  const timeline = data.version >= 2 ? timelineDocument(data.timeline, (id, kind) => ids.has(id) && (kind === 'audio' || !audio.has(id))) : undefined
  requireValid(data.version === 3 || !timeline?.tracks.some(track => track.clips.some(clip => clip.animation)))
  return { version: data.version, ...(timeline ? { timeline } : {}), media, clips, appearance, frame, profile, encoder: data.encoder, burn: data.burn !== false,
    mastering: studioAudioSettings(data.mastering) }
}

async function describe(path) {
  requireValid(localPath(path) && mediaFormat(path))
  const resolved = await realpath(path)
  requireValid(localPath(resolved) && mediaFormat(resolved))
  const info = await stat(resolved)
  requireValid(info.isFile() && info.size > 0)
  const hash = createHash('sha256').update(String(info.size))
  for (const start of new Set([0, Math.max(0, info.size - 32768)])) {
    for await (const chunk of createReadStream(resolved, { start, end: Math.min(info.size - 1, start + 32767) })) hash.update(chunk)
  }
  return { path: resolved, size: info.size, fingerprint: hash.digest('hex') }
}

async function atomic(path, content) {
  const part = join(dirname(path), '.viralcut-project-' + randomUUID() + '.tmp')
  try {
    await writeFile(part, content, { flag: 'wx', flush: true })
    await rename(part, path)
  } finally {
    await unlink(part).catch(() => {})
  }
}

async function readDocument(path) {
  const source = await open(path, 'r')
  try {
    const info = await source.stat()
    requireValid(info.isFile() && info.size > 0 && info.size <= maxBytes)
    const bytes = Buffer.alloc(info.size + 1)
    let size = 0
    while (size < bytes.length) {
      const { bytesRead } = await source.read(bytes, size, bytes.length - size, size)
      if (!bytesRead) break
      size += bytesRead
    }
    requireValid(size === info.size)
    return projectDocument(JSON.parse(bytes.toString('utf8', 0, size)))
  } finally { await source.close() }
}

export function createProjectStore(recoveryFile, previousRelease) {
  // Renderer operations are scoped to files registered through a user selection or a validated project.
  const registered = new Map()
  let autosaveWrites = Promise.resolve()
  let lastContent
  const older = recoveryFile + '.previous'
  async function findRecovery() {
    let damaged = false
    for (const path of [recoveryFile, older, ...[previousRelease].flat()].filter(Boolean)) {
      try { return { document: await readDocument(path), fallback: path !== recoveryFile } }
      catch (error) { if (error.code !== 'ENOENT') damaged = true }
    }
    return { damaged }
  }

  function view(id, entry, cues = []) {
    return { id, name: basename(entry.path), size: entry.size, cues, missing: !entry.available, ...(mediaFormat(entry.path).startsWith('audio/') ? { audioOnly: true } : {}) }
  }

  async function register(path, reuse = false, audioOnly = false) {
    const media = await describe(path)
    requireValid(mediaFormat(media.path).startsWith('audio/') === audioOnly)
    if (reuse) for (const [id, entry] of registered) {
      if (entry.available && entry.path === media.path && entry.fingerprint === media.fingerprint) return view(id, entry)
    }
    const id = randomUUID()
    registered.set(id, { ...media, available: true })
    return view(id, registered.get(id))
  }

  async function relink(id, path) {
    const previous = registered.get(id)
    requireValid(previous && !previous.available)
    const next = await describe(path)
    requireValid(next.size === previous.size && next.fingerprint === previous.fingerprint &&
      mediaFormat(next.path) === mediaFormat(previous.path))
    registered.set(id, { ...next, available: true })
    return view(id, registered.get(id))
  }

  async function hydrate(document) {
    const media = []
    for (const item of document.media) {
      let entry = { path: item.path, size: item.size, fingerprint: item.fingerprint, available: false }
      try {
        const current = await describe(item.path)
        if (current.size === item.size && current.fingerprint === item.fingerprint) entry = { ...current, available: true }
      } catch {
        // The original link is preserved until the user chooses its new location.
      }
      const id = randomUUID()
      registered.set(id, entry)
      media.push(view(id, entry, item.cues))
    }
    const ids = new Map(media.map((item, index) => [document.media[index].id, item.id]))
    return { ...document, media,
      ...(document.timeline ? { timeline: remapTimeline(document.timeline, ids) } : {}),
      clips: document.clips.map(clip => ({ ...clip, mediaId: ids.get(clip.mediaId) })) }
  }

  function serialize(state) {
    requireValid(Array.isArray(state?.media) && state.media.length <= 100)
    const media = state.media.map(item => {
      const entry = registered.get(item?.id)
      requireValid(entry)
      return { id: item.id, path: entry.path, size: entry.size, fingerprint: entry.fingerprint, cues: item.cues }
    })
    const content = JSON.stringify(projectDocument({ ...state, media }))
    requireValid(Buffer.byteLength(content) <= maxBytes)
    return content
  }

  return {
    register, relink,
    isAudio(id) { const entry = registered.get(id); return !!entry && mediaFormat(entry.path).startsWith('audio/') },
    async protects(path) {
      const resolved = await realpath(path).catch(() => null)
      if (!resolved) return false
      const normalized = resolved.toLowerCase()
      return [...registered.values()].some(entry => entry.available && entry.path.toLowerCase() === normalized)
    },
    resolveMedia(id) {
      const entry = registered.get(id)
      return entry?.available ? { path: entry.path, format: extname(entry.path).slice(1).toLowerCase(), size: entry.size } : null
    },
    async open(path) {
      requireValid(localPath(path) && extname(path).toLowerCase() === '.viralcut')
      const resolved = await realpath(path)
      requireValid(localPath(resolved) && extname(resolved).toLowerCase() === '.viralcut')
      return hydrate(await readDocument(resolved))
    },
    async save(path, state) {
      requireValid(localPath(path) && extname(path).toLowerCase() === '.viralcut')
      await atomic(path, serialize(state))
    },
    async recovery() {
      const result = await findRecovery()
      return { available: !!result.document, damaged: !!result.damaged, fallback: !!result.fallback }
    },
    async recover() {
      const { document } = await findRecovery()
      requireValid(document)
      return hydrate(document)
    },
    autosave(state) {
      const content = serialize(state)
      autosaveWrites = autosaveWrites.catch(() => {}).then(async () => {
        await mkdir(dirname(recoveryFile), { recursive: true })
        const oldContent = lastContent ?? await readDocument(recoveryFile).then(JSON.stringify, () => undefined)
        if (content === oldContent) return
        if (oldContent) await atomic(older, oldContent)
        await atomic(recoveryFile, content)
        lastContent = content
      })
      return autosaveWrites
    },
    settled() { return autosaveWrites.catch(() => {}) },
    async stream(request, response, id, proxyPath) {
      const entry = proxyPath ? { path: proxyPath, available: true } : registered.get(id)
      if (!entry?.available || !['GET', 'HEAD'].includes(request.method)) return response.writeHead(404).end()
      const info = await stat(entry.path).catch(() => null)
      if (!info?.isFile() || (!proxyPath && info.size !== entry.size)) return response.writeHead(404).end()
      const range = request.headers.range
      const match = range && /^bytes=(\d*)-(\d*)$/.exec(range)
      const start = match ? (match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]))) : 0
      const end = match?.[1] && match[2] ? Math.min(info.size - 1, Number(match[2])) : info.size - 1
      if ((range && (!match || (!match[1] && !match[2]))) || !Number.isSafeInteger(start) || start > end) {
        return response.writeHead(416, { 'Content-Range': 'bytes */' + info.size }).end()
      }
      response.writeHead(range ? 206 : 200, {
        'Content-Type': mediaFormat(entry.path), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
        'Content-Length': end - start + 1, ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + info.size } : {}),
      })
      if (request.method === 'HEAD') return response.end()
      const stream = createReadStream(entry.path, { start, end })
      response.on('close', () => stream.destroy())
      stream.on('error', () => response.destroy()).pipe(response)
    },
  }
}
