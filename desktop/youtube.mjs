import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { open, readFile, stat, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { creatorMetadata } from '../server/creator.mjs'

const scopes = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']
const google = 'https://www.googleapis.com'
const enc = value => new URLSearchParams(value)

export function youtubeError(status, reason) {
  if (status === 429 || ['quotaExceeded', 'dailyLimitExceeded', 'uploadLimitExceeded', 'rateLimitExceeded'].includes(reason)) return 'youtubeQuota'
  if (status === 401 || status === 403 || reason === 'invalid_grant') return 'youtubePermission'
  return 'youtubeRejected'
}

export function uploadMetadata(raw, channel, now = Date.now()) {
  if (!['private', 'unlisted', 'public'].includes(raw.privacy) || typeof raw.forKids !== 'boolean' ||
      typeof raw.synthetic !== 'boolean') throw Error('badMetadata')
  const scheduled = raw.publishAt
  if (scheduled && (raw.privacy !== 'private' || !Number.isFinite(Date.parse(scheduled)) || Date.parse(scheduled) < now + 60000)) throw Error('youtubeSchedule')
  const copy = creatorMetadata('youtube', raw)
  return { snippet: { title: copy.title, description: copy.caption, categoryId: '22', channelId: channel },
    status: { privacyStatus: raw.privacy, selfDeclaredMadeForKids: raw.forKids, containsSyntheticMedia: raw.synthetic,
      ...(scheduled ? { publishAt: new Date(scheduled).toISOString() } : {}) } }
}

function credentials(raw) {
  const value = raw?.installed
  if (!value || typeof value.client_id !== 'string' || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(value.client_id) ||
      typeof value.client_secret !== 'string' || !/^[\w-]{8,200}$/.test(value.client_secret)) throw Error('youtubeCredentials')
  return { client_id: value.client_id, client_secret: value.client_secret }
}

async function authorizedCode(client, openBrowser, signal) {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(24).toString('base64url')
  let redirect
  let resolve, reject
  const reply = new Promise((yes, no) => { resolve = yes; reject = no })
  const server = createServer((req, res) => {
    const url = redirect && URL.parse(req.url, redirect)
    if (!url || req.method !== 'GET' || req.headers.host !== new URL(redirect).host || url.origin !== new URL(redirect).origin || url.pathname !== '/youtube-oauth' ||
        url.searchParams.get('state') !== state) { res.writeHead(400).end(); return }
    const code = url.searchParams.get('code')
    res.writeHead(code ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(code ? 'ViralCut AI: You can close this tab.' : 'ViralCut AI: Authorization was declined.')
    if (code) resolve(code)
    else reject(Error('youtubePermission'))
  })
  const abort = () => reject(signal.reason)
  try {
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
    redirect = 'http://127.0.0.1:' + server.address().port + '/youtube-oauth'
    signal.throwIfAborted()
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = enc({ client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '),
      state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account' }).toString()
    signal.addEventListener('abort', abort, { once: true })
    await Promise.all([openBrowser(url.href), reply])
    return { code: await reply, code_verifier: verifier, redirect_uri: redirect }
  } finally { signal.removeEventListener('abort', abort); server.close(); server.closeAllConnections() }
}

export function createYouTube({ folder, storage, openBrowser, request = fetch }) {
  const file = join(folder, 'youtube.secure')
  const shutdown = new AbortController()
  let upload, connecting
  const bound = (signal, ms) => AbortSignal.any([shutdown.signal, signal ?? shutdown.signal, AbortSignal.timeout(ms)])
  async function json(response) {
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw Error(youtubeError(response.status, result.error?.errors?.[0]?.reason ?? result.error))
    return result
  }
  async function token(fields, signal) {
    return json(await request('https://oauth2.googleapis.com/token', { method: 'POST', body: enc(fields), redirect: 'error', signal: bound(signal, 20000) }))
  }
  async function load() {
    if (!storage.isEncryptionAvailable()) return
    const info = await stat(file).catch(() => null)
    if (!info?.isFile() || info.size > 65536) return
    try { return JSON.parse(storage.decryptString(await readFile(file))) } catch { return undefined }
  }
  async function store(value) {
    if (!storage.isEncryptionAvailable()) throw Error('youtubeStorage')
    const temp = file + '-' + randomBytes(12).toString('hex') + '.tmp'
    try { await writeFile(temp, storage.encryptString(JSON.stringify(value)), { flag: 'wx', flush: true }); await rename(temp, file) }
    finally { await unlink(temp).catch(() => {}) }
  }
  const authorization = access => ({ Authorization: 'Bearer ' + access })
  async function get(path, access, signal) {
    return json(await request(google + path, { headers: authorization(access), redirect: 'error', signal: bound(signal, 20000) }))
  }
  const info = data => data?.channel
  return {
    async account() { return info(await load()) },
    async connect(path) {
      if (connecting || upload?.phase === 'uploading') throw Error('busy')
      if (!storage.isEncryptionAvailable()) throw Error('youtubeStorage')
      const signal = bound(undefined, 180000)
      connecting = (async () => {
        if ((await stat(path)).size > 32768) throw Error('youtubeCredentials')
        const client = credentials(JSON.parse(await readFile(path, 'utf8')))
        const code = await authorizedCode(client, openBrowser, signal)
        const auth = await token({ ...client, ...code, grant_type: 'authorization_code' }, signal)
        if (!auth.refresh_token || !scopes.every(scope => auth.scope?.split(' ').includes(scope))) throw Error('youtubePermission')
        const response = await get('/youtube/v3/channels?part=id,snippet&mine=true', auth.access_token, signal)
        if (response.items?.length !== 1) throw Error('youtubeChannel')
        const item = response.items[0]
        if (!/^[\w-]{10,50}$/.test(item.id) || typeof item.snippet?.title !== 'string') throw Error('youtubeChannel')
        const channel = { id: item.id, name: item.snippet.title.slice(0, 200) }
        await store({ channel, client, refresh: auth.refresh_token })
        return channel
      })()
      try { return await connecting } finally { connecting = undefined }
    },
    async disconnect() {
      if (connecting || upload?.phase === 'uploading') throw Error('busy')
      const data = await load()
      await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
      if (data) await request('https://oauth2.googleapis.com/revoke', { method: 'POST', body: enc({ token: data.refresh }),
        redirect: 'error', signal: bound(undefined, 10000) }).catch(() => {})
    },
    status: () => upload && { ...upload, controller: undefined, work: undefined },
    cancel() { upload?.controller.abort() },
    async start(path, raw, confirm) {
      if (connecting || upload?.phase === 'uploading') throw Error('busy')
      const data = await load()
      if (!data || raw.channel !== data.channel.id) throw Error('youtubePermission')
      const metadata = uploadMetadata(raw, data.channel.id)
      if (!await confirm(data.channel, metadata)) return { cancelled: true }
      const controller = new AbortController()
      const signal = bound(controller.signal, 15 * 60 * 1000)
      const job = { phase: 'uploading', progress: 0, controller }
      upload = job
      job.work = (async () => {
        const input = await open(path, 'r')
        try {
          const { size } = await input.stat()
          const auth = await token({ ...data.client, refresh_token: data.refresh, grant_type: 'refresh_token' }, signal)
          const headers = authorization(auth.access_token)
          const initialized = await request(google + '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'video/mp4',
              'X-Upload-Content-Length': String(size) }, body: JSON.stringify(metadata), redirect: 'error', signal: bound(signal, 20000),
          })
          if (!initialized.ok) await json(initialized)
          const location = new URL(initialized.headers.get('location') ?? google)
          if (location.origin !== google || location.username || location.password || location.pathname !== '/upload/youtube/v3/videos') throw Error('youtubeRejected')
          const buffer = Buffer.alloc(4 * 1024 * 1024)
          let offset = 0, failures = 0, video
          while (offset < size) {
            const length = Math.min(buffer.length, size - offset)
            if ((await input.read(buffer, 0, length, offset)).bytesRead !== length) throw Error('badSource')
            const result = await request(location, { method: 'PUT', headers: { ...headers, 'Content-Type': 'video/mp4',
              'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}` },
              body: buffer.subarray(0, length), redirect: 'manual', signal: bound(signal, 120000),
            }).catch(() => undefined)
            let reply = result
            if (!reply || reply.status >= 500) {
              signal.throwIfAborted()
              if (++failures > 3) throw Error('youtubeNetwork')
              await setTimeout(1000 * failures, undefined, { signal })
              reply = await request(location, { method: 'PUT', headers: { ...headers, 'Content-Range': 'bytes */' + size },
                body: '', redirect: 'manual', signal: bound(signal, 20000) })
            }
            if (reply.status !== 308) { video = await json(reply); break }
            const last = /^bytes=0-(\d+)$/.exec(reply.headers.get('range') ?? '')
            const next = last ? Number(last[1]) + 1 : 0
            if (next < offset || next > offset + length) throw Error('youtubeRejected')
            if (next === offset && ++failures > 3) throw Error('youtubeNetwork')
            if (next > offset) failures = 0
            offset = next
            job.progress = Math.floor(offset * 100 / size)
          }
          if (!/^[\w-]{11}$/.test(video?.id ?? '')) throw Error('youtubeRejected')
          job.id = video.id
          job.progress = 100
          job.phase = 'uploaded'
          // Upload completion is distinct from verification and public visibility.
          try {
            const verified = await get('/youtube/v3/videos?part=snippet,status,statistics&id=' + video.id, auth.access_token, signal)
            const row = verified.items?.find(item => item.id === video.id && item.snippet?.channelId === data.channel.id)
            if (row) {
              job.phase = ['failed', 'rejected', 'deleted'].includes(row.status?.uploadStatus) ? 'failed' : 'verified'
              job.visibility = row.status?.privacyStatus
              job.publishAt = row.status?.publishAt
              job.processing = row.status?.uploadStatus
              job.metrics = { views: row.statistics?.viewCount, likes: row.statistics?.likeCount, comments: row.statistics?.commentCount }
            }
          } catch { /* The video ID still records the acknowledged upload. */ }
        } finally { await input.close() }
      })().catch(error => {
        job.phase = controller.signal.aborted ? 'cancelled' : 'failed'
        job.error = /^(youtube\w+|badSource)$/.test(error.message) ? error.message : 'youtubeNetwork'
      })
      return { started: true }
    },
    async close() { shutdown.abort(); await Promise.allSettled([upload?.work, connecting]) },
  }
}
