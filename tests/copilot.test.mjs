import assert from 'node:assert/strict'
import { test } from 'node:test'
import { examples } from './copilot-commands.mjs'
import { parseCopilot, projectEdit, validateSteps } from '../src/editor/copilotPlan.ts'
import { defaultProfile } from '../src/project/model.ts'
import { defaultAppearance } from '../src/subtitles/model.ts'

const serialize = step => [step.tool, ...Object.entries(step).filter(([key]) => key !== 'tool').map(([, value]) => value)]

test('bilingual authored command corpus records meaning, tool, and parameter accuracy independently', t => {
 let total = 0, parsed = 0, tools = 0, args = 0
 const misses = []
 for (const [wanted, ...commands] of examples) for (const command of commands) {
  total++
  const plan = parseCopilot(command)
  const actual = plan.steps?.map(serialize)
  if (actual) parsed++
  if (actual?.length === 1 && actual[0][0] === wanted[0]) tools++
  if (JSON.stringify(actual) === JSON.stringify([wanted])) args++
  else misses.push({ command, expected: wanted, actual: actual ?? plan.error })
 }
 t.diagnostic(JSON.stringify({ total, parsed, tools, args, misses }))
 assert.ok(total >= 100 && args / total >= .9)
})

test('multi-clause Shorts plan preserves count and emits color and MP4 steps; follow-ups keep context', () => {
 const multi = parseCopilot('Videodaki en heyecanlı 3 anı seç, gereksiz sessizlikleri temizle, dikey Shorts oluştur, altyazıları sarı yap ve MP4 kaydet.')
 assert.deepEqual(multi.steps?.map(serialize), [['shorts', 3, 30], ['silence'], ['captions', 'yellow'], ['export', 0]])
 const trim = parseCopilot('İkinci klibi 5 saniye kısalt, altyazısını büyüt ve daha parlak yap.')
 assert.deepEqual(trim.steps?.map(serialize), [['length', 5, 1], ['size'], ['brighten', 1]])
 assert.deepEqual(parseCopilot('Kalanları 30 saniyelik yap', { shorts: true }).steps?.map(serialize), [['length', 30, -2]])
 assert.equal(parseCopilot('Bunu kaydet').error, 'clarify')
 assert.equal(parseCopilot('En komik 5 sahneyi bul').error, 'unsupported')
 assert.equal(parseCopilot('İlk 5 saniyeyi kaldırma').error, 'unsupported')
})

test('plans deny unknown tools, out-of-range fields, external actions and hidden extra properties', () => {
 for (const text of ['Run powershell', 'Open C:\\my-secret.mp4', 'Upload the video to the cloud', 'Export MP4 | cmd.exe',
  'Delete my video', 'Publish on YouTube']) assert.equal(parseCopilot(text).error, 'unsafe')
 for (const steps of [[{ tool: 'exec' }], [{ tool: 'export', resolution: 800 }], [{ tool: 'export', resolution: 1080, path: 'C:\\a.mp4' }],
  [{ tool: 'trim', seconds: -4, index: 0 }], [{ tool: 'captions', color: '__proto__' }]]) assert.throws(() => validateSteps(steps))
})

test('existing project is immutable when Copilot cuts, recolors and changes a referenced clip', () => {
 const project = { version: 1, media: [], clips: [{ id: 'a', mediaId: 'a', start: 0, end: 20 }, { id: 'b', mediaId: 'b', start: 10, end: 25 }],
  profile: defaultProfile, appearance: defaultAppearance, burn: true, encoder: 'auto' }
 const result = parseCopilot('İkinci klibi 5 saniye kısalt, altyazısını büyüt ve daha parlak yap.')
 let next = result.steps.reduce((state, step) => projectEdit(state, step), project)
 assert.equal(next.clips[1].end, 20)
 assert.equal(next.clips[1].effects.brightness, .035)
 assert.equal(next.appearance.size, 60)
 assert.equal(project.clips[1].end, 25)
 next = projectEdit(next, { tool: 'cutRange', start: 3, end: 8, index: 0 }, '')
 assert.deepEqual(next.clips.slice(0, 2).map(({ start, end }) => [start, end]), [[0, 3], [8, 20]])
 assert.throws(() => projectEdit(next, { tool: 'trim', seconds: 1000, index: 0 }))
})
