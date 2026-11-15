import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSemanticService } from '../server/semantic-service.mjs'
import { cosine, rankSemantic, speechUnits, topicBoundaries } from '../server/semantic-ranking.mjs'
import { loadSemanticModel } from '../server/semantic-model.mjs'

const fixture = [
  { start: 0, end: 5, text: 'Bahçe toprağını nasıl iyileştirebiliriz?' },
  { start: 6, end: 14, text: 'Toprağa kompost ekleyip karıştırarak' },
  { start: 14.1, end: 29, text: 'bitkilerin kök gelişimini destekleyebiliriz.' },
  { start: 34, end: 61, text: 'Bahçe toprağına kompost ekleyip karıştırarak bitkilerin kök gelişimini destekleyebiliriz.' },
  { start: 65, end: 92, text: 'Astronomers track comets with telescopes and calculate their paths around the sun.' },
  { start: 96, end: 123, text: 'A bread recipe explains how the baker should knead the dough and preheat the oven.' },
]

test('context joins fragments and retains question-answer, filters damaged cues and deduplicates proposals', () => {
  const units = speechUnits([...fixture, null, { start: 2, end: 1, text: 'bad' }, { start: 2, end: 3, text: 12 }], 130)
  assert.equal(units.length, 5)
  const vectors = [[1, 0, 0], [.86, .13, 0], [.86, .13, 0], [0, 1, 0], [0, 0, 1]]
  assert.ok(topicBoundaries(units, vectors).some(Boolean))
  const clips = rankSemantic(units, vectors, [], 130, 30)
  assert.equal(clips.length, 3)
  assert.ok(clips.some(clip => clip.start === 0 && clip.end >= 29 && clip.evaluation.reasons.includes('qa')))
  assert.ok(!clips.some(clip => clip.start > 30 && clip.start < 40))
  assert.ok(clips.every(clip => clip.selected && ['coherence', 'hook', 'completion', 'silence', 'captions', 'length', 'similarity']
    .every(key => Object.hasOwn(clip.evaluation.metrics, key))))
  assert.ok(clips.every(clip => ['energy', 'scene', 'timing'].every(key => clip.evaluation.metrics[key] === null)))
  assert.deepEqual(speechUnits([null, {}], 30), [])
  const unfinished = speechUnits([{ start: 0, end: 17, text: 'And then we thought that...' }], 20)
  assert.deepEqual(rankSemantic(unfinished, null, [], 20, 15), [])
  for (const target of [15, 30, 60]) {
    const exact = speechUnits([{ start: 0, end: target, text: 'Bu bölüm kendi başına tamamlanıyor.' }], target)
    assert.equal(rankSemantic(exact, null, [], target, target)[0].end, target)
  }
})

test('worker reports fallback and stops on cancellation', async () => {
  const service = createSemanticService()
  const previous = process.env.VIRALCUT_SEMANTIC_MODEL
  process.env.VIRALCUT_SEMANTIC_MODEL = 'Z:/viralcut-test-missing-model'
  try {
    const data = { cues: fixture, silences: [], duration: 130, goal: 30 }
    const result = await service.analyze(data, AbortSignal.timeout(10000), () => {})
    assert.equal(result.mode, 'rules')
    assert.equal(result.reason, 'modelMissing')
    assert.ok(result.candidates.every(clip => clip.evaluation.metrics.coherence === null))
    const controller = new AbortController()
    const pending = service.analyze(data, controller.signal, () => {})
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
  } finally {
    if (previous === undefined) delete process.env.VIRALCUT_SEMANTIC_MODEL
    else process.env.VIRALCUT_SEMANTIC_MODEL = previous
    await service.close()
  }
})

test('real quantized E5 recognizes related Turkish and English meaning on CPU', { skip: process.env.VIRALCUT_SEMANTIC_TEST !== '1' }, async t => {
  const embed = await loadSemanticModel()
  const [tr, en, other] = await embed(['Gökbilimciler teleskopla kuyruklu yıldızları izliyor.',
    'Astronomers watch comets using a telescope.', 'Bakers knead bread and preheat the oven.'])
  assert.equal(tr.length, 384)
  assert.ok(cosine(tr, en) > cosine(tr, other) + .05)
  t.diagnostic(JSON.stringify({ related: cosine(tr, en), unrelated: cosine(tr, other) }))
})
