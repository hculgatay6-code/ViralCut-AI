import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { inputOptions, probe, run } from '../server/media.mjs'
import { createPreviewQueue } from '../server/preview.mjs'
import { createResourceBudget } from '../server/resource-budget.mjs'

const path = resolve(process.argv[2] ?? '')
assert.ok(process.argv[2], 'Pass a local 1080p or 4K H.264 MP4 fixture')
const signal = AbortSignal.timeout(90000)
const source = { path, format: 'mp4', size: (await stat(path)).size }
const info = await probe(path, 'mp4', signal)
const video = info.streams.find(stream => stream.codec_type === 'video')
assert.ok(video?.width >= 1920 && video.codec_name === 'h264')
await run('ffmpeg', ['-v', 'error', '-nostdin', '-xerror', '-hwaccel', 'cuda', ...inputOptions('mp4'),
  '-i', path, '-frames:v', '4', '-an', '-vf', 'scale=640:360', '-c:v', 'h264_nvenc', '-f', 'null', '-'], signal)
const folder = await mkdtemp(join(tmpdir(), 'viralcut-v22-hardware-'))
const budget = createResourceBudget()
budget.change('performance')
const queue = createPreviewQueue(id => id === 'fixture' ? source : null, undefined, {
  budget, directory: folder, hardware: () => ({ nvenc: true, decode: 'cuda' }),
})
try {
  const started = performance.now()
  queue.start('fixture', 'proxy', 540)
  let result
  do {
    await delay(75, undefined, { signal })
    result = queue.status('fixture', 'proxy', 540)
  } while (['running', 'queued'].includes(result.phase))
  assert.equal(result.phase, 'ready', result.error)
  assert.equal(result.encoder, 'NVENC')
  assert.equal(result.decoder, 'cuda')
  console.log(JSON.stringify({ ...result, duration: Number(info.format.duration), elapsedMs: Math.round(performance.now() - started) }))
} finally {
  await queue.close()
  await rm(folder, { recursive: true, force: true, maxRetries: 4 })
}
