import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDirectorPlan } from '../src/editor/directorPlan.ts'
import { prepareDirector } from '../desktop/director.mjs'
import { createProjectStore } from '../desktop/projects.mjs'
import { readShortsAnalysis, batchSize } from '../server/shorts-batch.mjs'

const entry = (id, start, score, text) => ({ id, start, end: start + 30, text, evaluation: { score, metrics: {}, reasons: [] } })
const phrase = 'Akşam erken saatte kütüphanedeki tarihi haritaları inceledik.'
const analysis = { hasAudio: true, cues: [{ start: 2, end: 6, text: phrase }], silences: [{ start: 1, end: 8 }],
  selection: { candidates: [entry(0, 0, 80, phrase), entry(1, 2, 79, 'Başka metin.'), entry(2, 35, 78, phrase),
    entry(3, 66, 43, 'Düşük puan'), entry(4, 99, 81, 'Bambaşka bir konu.')] } }

test('director suppresses repeat ranges and repeat language, preserves speech, and orders output by source time', () => {
  const plan = createDirectorPlan(analysis, 5, 'education')
  assert.deepEqual(plan.map(row => row.clip.id), [0, 4])
  assert.equal(plan[0].item.overlay.appearance.size, 45)
  assert.ok(plan[0].item.remove.every(span => span.end <= 2 || span.start >= 6))
  assert.equal(plan[1].item.overlay, undefined)
  assert.equal(readShortsAnalysis({ director: true, goal: 0, duration: 120, language: 'auto', device: 'auto',
    analysis: { threshold: -38, minimum: .65 } }).goal, 0)
  assert.equal(batchSize({ items: Array(10), resolution: 1080, encoder: 'auto' }), true)
  assert.equal(batchSize({ items: Array(11), resolution: 1080, encoder: 'auto' }), false)
})

test('director writes reopenable editable projects and persists cuts without touching the original', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'viralcut-director-test-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const input = join(folder, 'source.mp4')
  const bytes = Buffer.from('source content for project persistence')
  await writeFile(input, bytes)
  const store = createProjectStore(join(folder, 'recovery.viralcut'))
  const media = await store.register(input)
  const items = createDirectorPlan(analysis, 1, 'podcast').map(row => row.item)
  const result = await prepareDirector({ mediaId: media.id, items, encoder: 'auto', resolution: 720 }, folder, store)
  const reopened = await store.open(result.projectFiles[0])
  assert.equal(reopened.frame.mode, 'vertical')
  assert.equal(reopened.profile.resolution, 720)
  assert.deepEqual(reopened.clips.map(({ start, end }) => [start, end]), [[99, 129]])
  const manifest = JSON.parse(await readFile(join(result.folder, 'Edit-plan.json'), 'utf8'))
  assert.equal(manifest.clips[0].project, 'Short-1.viralcut')
  assert.deepEqual(await readFile(input), bytes)
})
