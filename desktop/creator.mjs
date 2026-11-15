import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { creatorMetadata, creatorProfile } from '../server/creator.mjs'
import { validateBatchItem } from '../server/shorts-batch.mjs'
import { ExportError } from '../server/media.mjs'
import { localPath } from './projects.mjs'

const validDate = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const allowedFile = /^(youtube|tiktok|instagram)-[a-f0-9]{8}\.mp4$/

export function createCalendar(folder, previousFolder) {
  const file = join(folder, 'creator-calendar.json')
  let queue = Promise.resolve()
  async function list() {
    const paths = previousFolder && previousFolder !== folder ? [file, join(previousFolder, 'creator-calendar.json')] : [file]
    for (const path of paths) {
      try {
        if ((await stat(path)).size > 4e6) throw Error('calendarSize')
        const rows = JSON.parse(await readFile(path, 'utf8'))
        if (!Array.isArray(rows) || rows.length > 250) throw Error('calendarSize')
        return rows
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return []
  }
  return {
    list,
    save(raw, filename) {
      const work = queue.then(async () => {
        const rows = await list()
        const current = raw.id ? rows.find(row => row.id === raw.id) : undefined
        if (raw.id && !current) throw Error('calendarId')
        const { platform, plannedAt } = raw
        const metadata = creatorMetadata(platform, raw)
        if (plannedAt && !validDate(plannedAt)) throw Error('calendarDate')
        const output = filename ?? (current?.platform === platform ? current.filename : undefined)
        if (output && !allowedFile.test(output)) throw Error('calendarFile')
        const row = { id: current?.id ?? randomUUID(), platform, ...metadata, filename: output,
          plannedAt: plannedAt || '', status: plannedAt ? 'planned' : output ? 'ready' : 'draft',
          createdAt: current?.createdAt ?? new Date().toISOString() }
        const next = [...rows.filter(item => item.id !== row.id), row]
        if (next.length > 250) throw Error('calendarSize')
        await mkdir(folder, { recursive: true })
        const temp = join(folder, '.calendar-' + randomUUID() + '.tmp')
        try {
          await writeFile(temp, JSON.stringify(next), { flag: 'wx', flush: true })
          await rename(temp, file)
        } finally { await unlink(temp).catch(() => {}) }
        return row
      })
      queue = work.catch(() => {})
      return work
    },
    settled: () => queue,
  }
}

export async function prepareCreator(request, destination, projects) {
  if (!localPath(destination) || !projects.resolveMedia(request.mediaId) ||
      !Array.isArray(request.items) || request.items.length < 1 || request.items.length > 15) throw new ExportError('badEdit', 400)
  const parent = await realpath(destination)
  if (!localPath(parent) || !(await stat(parent)).isDirectory()) throw new ExportError('saveFailed')
  const job = { creator: true, mediaId: request.mediaId, resolution: 1080, encoder: 'auto',
    items: request.items.map(item => ({ ...item, metadata: creatorMetadata(item.platform, item.metadata) })) }
  for (const item of job.items) validateBatchItem(item, job)
  const profiles = job.items.map(item => creatorProfile(item.platform, item.preset))
  const folder = join(parent, 'ViralCut-Creator-' + randomUUID().slice(0, 12))
  await mkdir(folder)
  return { folder, job, profiles }
}
