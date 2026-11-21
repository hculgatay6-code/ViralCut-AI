import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readdir, rename, rmdir, statfs, unlink, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExportError } from './media.mjs'

const mib = 1024 ** 2
const asset = /^[a-f0-9]{64}\.mp4$/
const partial = /^[a-f0-9-]{36}\.part$/
export const proxyProfiles = [360, 540, 720]
export const proxyRates = { 360: 1600, 540: 3000, 720: 5000 }

export async function mediaIdentity(source) {
  const info = await lstat(source.path, { bigint: true }).catch(() => null)
  if (!info?.isFile() || info.size !== BigInt(source.size)) throw new ExportError('missingProjectMedia')
  return [source.path, source.format, info.size, info.ino, info.mtimeNs, info.ctimeNs].map(String)
}

export function proxyKey(identity, height) {
  return createHash('sha256').update(JSON.stringify([1, height, identity])).digest('hex')
}

export function createProxyCache(directory, { maxBytes = 2048 * mib, maxEntries = 12, reserve = 512 * mib } = {}) {
  let hits = 0
  const folder = (async () => {
    if (!directory) return mkdtemp(join(tmpdir(), 'viralcut-proxy-v22-'))
    await mkdir(directory, { recursive: true })
    if (!(await lstat(directory)).isDirectory()) throw new ExportError('accessDenied')
    for (const name of await readdir(directory)) {
      if (partial.test(name)) await unlink(join(directory, name)).catch(() => {})
    }
    return directory
  })()
  // Startup and the renderer may never ask for a proxy.
  folder.catch(() => {})

  async function assets(path) {
    return (await Promise.all((await readdir(path)).filter(name => asset.test(name)).map(async name => {
      const file = join(path, name)
      const info = await lstat(file).catch(() => null)
      return info?.isFile() ? { file, bytes: info.size, used: info.mtimeMs } : null
    }))).filter(Boolean)
  }

  return {
    async lookup(key, touch = false) {
      const file = join(await folder, key + '.mp4')
      const info = await lstat(file).catch(() => null)
      if (!info?.isFile() || !info.size) return
      if (touch) {
        hits++
        const now = new Date()
        await utimes(file, now, now).catch(() => {})
      }
      return { path: file, format: 'mp4', size: info.size, proxyKey: key }
    },
    async prepare(estimate) {
      if (estimate > maxBytes) throw new ExportError('proxyLimit')
      const path = await folder
      const available = await statfs(path).then(info => info.bavail * info.bsize)
      if (available < reserve + estimate) throw new ExportError('diskFull', 507)
      return join(path, randomUUID() + '.part')
    },
    async publish(temp, key) {
      const path = await folder
      const info = await lstat(temp)
      if (!info.isFile() || !info.size || info.size > maxBytes) throw new ExportError('proxyLimit')
      const files = (await assets(path)).sort((a, b) => a.used - b.used)
      let bytes = files.reduce((sum, file) => sum + file.bytes, 0)
      let count = files.length
      for (const file of files) {
        if (count < maxEntries && bytes + info.size <= maxBytes) break
        if (await unlink(file.file).then(() => true, () => false)) { bytes -= file.bytes; count-- }
      }
      if (count >= maxEntries || bytes + info.size > maxBytes) throw new ExportError('proxyLimit')
      return rename(temp, join(path, key + '.mp4'))
    },
    async info() {
      const files = await assets(await folder).catch(() => [])
      return { entries: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), hits }
    },
    async clear() {
      const files = await assets(await folder)
      await Promise.all(files.map(file => unlink(file.file).catch(() => {})))
    },
    async close() {
      if (directory) return
      const path = await folder.catch(() => null)
      if (!path) return
      await this.clear()
      await rmdir(path).catch(() => {})
    },
  }
}
