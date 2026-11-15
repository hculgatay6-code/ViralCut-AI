import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { semanticAssets } from './semantic-model.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const version = 1
const maxEntry = 4 * 1024 * 1024
const filename = /^[a-f0-9]{64}\.json$/
// Cloud-synced Windows folders can change ctime when a read hydrates a file.
// Use file identity, content mtime and sampled content for the stable cache key.
const stamp = file => [file.dev, file.ino, file.size, file.mtimeNs].join(':')
const fileStamp = path => path ? stat(path, { bigint: true })
  .then(file => file.isDirectory() ? 'directory' : stamp(file), () => 'missing') : 'system'

export async function analysisKey(job) {
  if (!job.linked || job.kind !== 'shorts-analysis' || job.goal === undefined) return
  const base = join(process.env.LOCALAPPDATA ?? homedir(), 'ViralCutAI')
  const vision = process.env.VIRALCUT_VISION_MODEL ?? join(base, 'vision-v13')
  const semantic = process.env.VIRALCUT_SEMANTIC_MODEL ?? join(base, 'semantic-e5-small')
  const resources = await Promise.all([
    process.env.VIRALCUT_MODEL ?? join(base, 'ggml-base-q5_1.bin'), process.env.VIRALCUT_FFMPEG,
    process.env.VIRALCUT_FFPROBE,
    join(process.env.VIRALCUT_WHISPER_CPU ?? join(base, 'whisper-cpu'), 'whisper-cli.exe'),
    join(base, 'whisper-cuda', 'Release', 'whisper-cli.exe'),
    join(base, 'whisper-cpu', 'Release', 'whisper-cli.exe'),
    join(vision, 'ssd_mobilenet_v1_12-int8.onnx'), join(vision, 'version-slim-320.onnx'),
    ...Object.keys(semanticAssets).map(name => join(semantic, name)),
  ].map(fileStamp))
  const file = await open(job.input, 'r')
  try {
    const before = await file.stat({ bigint: true })
    if (!before.isFile() || before.size !== BigInt(job.linked.size)) return
    const length = Math.min(65536, job.linked.size)
    const hash = createHash('sha256')
    for (const offset of new Set([0, Math.floor((job.linked.size - length) / 2), job.linked.size - length])) {
      const sample = Buffer.alloc(length)
      const { bytesRead } = await file.read(sample, 0, length, offset)
      hash.update(sample.subarray(0, bytesRead))
    }
    if (stamp(await file.stat({ bigint: true })) !== stamp(before)) return
    return digest(JSON.stringify([version, job.format, stamp(before), hash.digest('hex'), resources,
      job.goal, job.language, job.device, job.analysis, job.visualMode, job.visualDevice, job.director]))
  } finally { await file.close() }
}

export function createAnalysisCache(folder, { maxBytes = 48 * 1024 * 1024, maxEntries = 24 } = {}) {
  let pending = Promise.resolve()
  let hits = 0
  const ready = mkdir(folder, { recursive: true }).then(() => lstat(folder)).then(info => info.isDirectory() && !info.isSymbolicLink(), () => false)
  const serial = action => {
    const next = pending.then(async () => { if (await ready) return action() })
    pending = next.catch(() => {})
    return next
  }
  async function inventory() {
    const files = await readdir(folder, { withFileTypes: true })
    return (await Promise.all(files.filter(file => file.isFile() && filename.test(file.name)).map(async file => {
      const path = join(folder, file.name)
      const info = await lstat(path).catch(() => null)
      return info?.isFile() ? { path, bytes: info.size, time: info.mtimeMs } : null
    }))).filter(Boolean)
  }
  return {
    read: key => serial(async () => {
      if (!/^[a-f0-9]{64}$/.test(key)) return
      const path = join(folder, key + '.json')
      const info = await lstat(path).catch(() => null)
      if (!info?.isFile() || info.size > maxEntry) return
      const handle = await open(path, 'r')
      try {
        const buffer = Buffer.alloc(info.size)
        let offset = 0
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
          if (!bytesRead) return
          offset += bytesRead
        }
        const first = buffer.indexOf(10)
        const payload = buffer.subarray(first + 1)
        if (first !== 64 || buffer.subarray(0, first).toString() !== createHash('sha256').update(key).update(payload).digest('hex')) return
        const data = JSON.parse(payload)
        if (data.version !== version || !Array.isArray(data.result?.cues) || !data.result.selection?.candidates) return
        hits++
        return data.result
      } finally { await handle.close() }
    }),
    write: (key, result, isCurrent = () => true) => serial(async () => {
      if (!/^[a-f0-9]{64}$/.test(key) || !isCurrent()) return
      const data = JSON.stringify({ version, result })
      const bytes = Buffer.byteLength(data) + 65
      if (bytes > Math.min(maxEntry, maxBytes)) return
      const path = join(folder, key + '.json')
      const files = (await inventory()).filter(file => file.path !== path).sort((a, b) => a.time - b.time)
      let remaining = files.reduce((sum, file) => sum + file.bytes, bytes)
      while (remaining > maxBytes || files.length >= maxEntries) {
        const file = files.shift()
        await unlink(file.path)
        remaining -= file.bytes
      }
      const temp = join(folder, key + '-' + randomUUID() + '.tmp')
      try {
        await writeFile(temp, digest(key + data) + '\n' + data, { flag: 'wx', flush: true })
        await rename(temp, path)
      } finally { await unlink(temp).catch(() => {}) }
    }),
    info: async () => await serial(async () => {
      const files = await inventory()
      return { entries: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), hits }
    }) ?? { entries: 0, bytes: 0, hits },
    clear: () => serial(async () => {
      const files = await readdir(folder, { withFileTypes: true })
      for (const file of files) if (file.isFile() && (filename.test(file.name) || /^[a-f0-9]{64}-[a-f0-9-]{36}\.tmp$/.test(file.name))) {
        await unlink(join(folder, file.name)).catch(error => { if (error.code !== 'ENOENT') throw error })
      }
      hits = 0
    }),
  }
}
