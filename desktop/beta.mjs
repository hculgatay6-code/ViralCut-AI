import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const repoPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/
const intervals = [0, 5, 15, 30, 60]
const defaults = { interval: 5, repository: '', language: 'tr' }
const maxReleaseBytes = 16 * 1024 * 1024

function validRepository(repository) {
  return typeof repository === 'string' && repoPattern.test(repository) && !['.', '..'].includes(repository.split('/')[1])
}

async function atomic(path, payload) {
  await mkdir(dirname(path), { recursive: true })
  const temp = path + '.' + randomUUID() + '.tmp'
  try { await writeFile(temp, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx', flush: true }); await rename(temp, path) }
  finally { await unlink(temp).catch(() => {}) }
}

function validate(raw) {
  if (!raw || !intervals.includes(raw.interval) || !['tr', 'en'].includes(raw.language) ||
      (raw.repository !== '' && !validRepository(raw.repository))) throw Error('invalidSettings')
  return { interval: raw.interval, repository: raw.repository, language: raw.language }
}

export async function betaSettings(folder) {
  const path = join(folder, 'beta-settings.json')
  let current = defaults
  try { if ((await stat(path)).size < 4096) current = validate(JSON.parse(await readFile(path, 'utf8'))) } catch { /* Use defaults. */ }
  let pending = Promise.resolve()
  return {
    read: () => ({ ...current }),
    save(raw) {
      const next = validate(raw)
      const work = pending.then(async () => { await atomic(path, next); current = next; return next })
      pending = work.catch(() => {})
      return work
    },
    settled: () => pending,
  }
}

export async function startSessionMarker(folder, record) {
  const path = join(folder, 'session-open')
  try {
    await stat(path)
    record('session', 'failed', undefined, 'uncleanExit')
  } catch (error) { if (error.code !== 'ENOENT') return async () => {} }
  try {
    await mkdir(folder, { recursive: true })
    await writeFile(path, '', { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
    return async () => { await unlink(path).catch(() => {}) }
  } catch { return async () => {} }
}

export async function saveDiagnosticReport(path, appVersion, diagnostics) {
  await atomic(path, { schema: 1, version: appVersion, platform: process.platform, architecture: process.arch,
    createdAt: new Date().toISOString(), entries: diagnostics.entries() })
}

function version(tag) {
  const match = /^v?(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?(?:-(alpha|beta|rc)(?:\.(\d{1,4}))?)?$/.exec(tag)
  return match && [Number(match[1]), Number(match[2]), Number(match[3] ?? 0),
    ['alpha', 'beta', 'rc', undefined].indexOf(match[4]), Number(match[5] ?? 0)]
}

function compare(a, b) {
  const first = a.findIndex((n, i) => n !== b[i])
  return first < 0 ? 0 : a[first] - b[first]
}

export async function checkGitHubRelease(repository, current, request = fetch) {
  if (!validRepository(repository)) return { state: 'unconfigured' }
  const ver = version(current)
  if (!ver) return { state: 'error' }
  try {
    const response = await request('https://api.github.com/repos/' + repository + '/releases?per_page=30', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ViralCut-AI-Desktop' },
      redirect: 'error', signal: AbortSignal.timeout(8000),
    })
    if (response.status === 404 || response.status === 401) return { state: 'unavailable' }
    if (response.status === 429 || response.status === 403) return { state: 'limited' }
    if (!response.ok) return { state: 'error' }
    if (Number(response.headers.get('content-length')) > maxReleaseBytes || !response.body) {
      await response.body?.cancel()
      return { state: 'error' }
    }
    const reader = response.body.getReader()
    const chunks = []
    let bytes = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maxReleaseBytes) { await reader.cancel(); return { state: 'error' } }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    let releases
    try { releases = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) } catch { return { state: 'error' } }
    if (!Array.isArray(releases)) return { state: 'error' }
    const latest = releases.slice(0, 30).flatMap(row => {
      if (!row || row.draft !== false || typeof row.tag_name !== 'string') return []
      const parsed = version(row.tag_name)
      return parsed && compare(parsed, ver) > 0 ? [{ row, parsed }] : []
    }).sort((a, b) => compare(b.parsed, a.parsed))[0]
    if (!latest) return { state: 'current' }
    return { state: 'available', tag: latest.row.tag_name, notes: typeof latest.row.body === 'string' ? latest.row.body.slice(0, 5000) : '' }
  } catch { return { state: 'offline' } }
}
