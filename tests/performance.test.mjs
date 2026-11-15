import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { analysisKey, createAnalysisCache } from '../server/analysis-cache.mjs'
import { createResourceBudget, fastDecode, ffmpegThreads } from '../server/resource-budget.mjs'

test('completed analysis survives restart, rejects corrupt data and invalidates source and settings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'viralcut-cache-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const input = join(root, 'source.mp4'), folder = join(root, 'cache')
  await writeFile(input, 'video-content')
  const job = { input, kind: 'shorts-analysis', linked: { size: 13 }, goal: 0, language: 'tr', format: 'mp4' }
  const key = await analysisKey(job)
  const settings = await analysisKey({ ...job, goal: 30 })
  assert.notEqual(settings, key)
  const cache = createAnalysisCache(folder, { maxEntries: 1 })
  const result = { cues: [], selection: { candidates: [1] } }
  await cache.write(key, result)
  assert.deepEqual(await createAnalysisCache(folder).read(key), result)
  await cache.write(settings, result)
  assert.equal(await cache.read(key), undefined)
  await writeFile(join(folder, settings + '.json'), 'partial')
  assert.equal(await cache.read(settings), undefined)
  await writeFile(input, 'other-content')
  assert.notEqual(await analysisKey(job), key)
  await writeFile(join(folder, 'unrelated.txt'), 'preserve')
  await cache.clear()
  assert.deepEqual(await readdir(folder), ['unrelated.txt'])
})

test('low available memory queues and cancels work; profiles change thread and hardware limits', async () => {
  const mib = 1048576
  let available = 512 * mib
  const budget = createResourceBudget({ free: () => available, total: () => 8192 * mib, cores: () => 12, poll: 10 })
  const cancel = new AbortController()
  const queued = budget.work('analyse', cancel.signal, () => assert.fail('blocked work ran'))
  assert.equal(budget.info().waiting, 1)
  assert.equal(budget.info().pressure, true)
  cancel.abort()
  await assert.rejects(queued, { name: 'AbortError' })
  available = 3200 * mib
  const signal = AbortSignal.timeout(1000)
  budget.change('eco')
  await budget.work('export', signal, () => assert.equal(ffmpegThreads(4), '2'))
  budget.change('performance')
  const order = []
  const first = budget.work('analysis', signal, async () => { order.push(fastDecode()); await setTimeout(30); order.push('done') }, { decode: 'cuda' })
  const second = budget.work('export', signal, () => order.push('export'))
  await Promise.all([first, second])
  assert.deepEqual(order, ['cuda', 'done', 'export'])
  assert.equal(budget.info().waiting, 0)
})
