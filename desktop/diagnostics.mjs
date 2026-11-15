import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const operations = new Set(['export', 'sequence', 'transcribe', 'silence', 'shorts-analysis', 'batch', 'proxy', 'waveform',
  'cleanup', 'startup', 'renderer', 'save-clip', 'project-save', 'project-open', 'project-autosave', 'project-recover',
  'studio-cover-save', 'studio-template-save', 'source-file', 'session', 'diagnostics-export', 'beta-settings-save'])
const outcomes = new Set(['ready', 'failed', 'cancelled'])
const codes = new Set(['badProject', 'badSource', 'badRange', 'badSubtitles', 'badEdit', 'badRequest', 'jobMissing',
  'diskFull', 'accessDenied', 'encodeFailed', 'verifyFailed', 'clipDecodeFailed', 'visualDecodeFailed', 'uploadFailed', 'saveFailed', 'noAudio', 'emptyEdit',
  'missingProjectMedia', 'sourceProtected', 'tooManyCues', 'toolsUnavailable', 'whisperUnavailable', 'transcriptFailed',
  'rendererGone', 'startupFailed', 'uncleanExit', 'invalidSettings', 'ENOSPC', 'EACCES', 'EPERM', 'EBUSY', 'ENOTEMPTY', 'ENOENT', 'EROFS'])

export async function createDiagnostics(folder) {
  const path = join(folder, 'diagnostics.json')
  const limit = 120
  const rows = []
  try {
    if ((await stat(path)).size <= 32768) {
      const previous = JSON.parse(await readFile(path, 'utf8'))
      if (Array.isArray(previous)) for (const row of previous.slice(-limit)) {
        if (operations.has(row?.operation) && outcomes.has(row.outcome) && typeof row.at === 'number' && Number.isFinite(row.at)) {
          rows.push({ at: row.at, operation: row.operation, outcome: row.outcome,
            ms: Number.isSafeInteger(row.ms) && row.ms >= 0 ? row.ms : undefined,
            code: codes.has(row.code) || row.code === 'unknown' ? row.code : undefined })
        }
      }
    }
  } catch { /* A missing or unreadable history does not block editing. */ }
  let pending = Promise.resolve()
  let generation = 0
  function record(operation, outcome, started, error) {
    if (!operations.has(operation) || !outcomes.has(outcome)) return
    rows.push({ at: Date.now(), operation, outcome, ms: Number.isFinite(started) ? Math.max(0, Math.round(performance.now() - started)) : undefined,
      code: outcome === 'failed' ? codes.has(error) ? error : 'unknown' : undefined })
    if (rows.length > limit) rows.shift()
    const revision = ++generation
    pending = pending.then(async () => {
      if (revision !== generation) return
      const temp = join(folder, '.viralcut-diagnostics-' + randomUUID() + '.tmp')
      try {
        await mkdir(folder, { recursive: true })
        await writeFile(temp, JSON.stringify(rows), { flag: 'wx' })
        await rename(temp, path)
      } finally { await unlink(temp).catch(() => {}) }
    }).catch(() => {})
  }
  return { record, entries: () => rows.slice().reverse(), settled: () => pending }
}
