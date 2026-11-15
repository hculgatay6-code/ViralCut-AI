import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { betaSettings, checkGitHubRelease, saveDiagnosticReport, startSessionMarker } from '../desktop/beta.mjs'
import { createDiagnostics } from '../desktop/diagnostics.mjs'
import { createProjectStore } from '../desktop/projects.mjs'
import { createCueLookup } from '../src/subtitles/lookup.ts'
import { defaultAppearance } from '../src/subtitles/model.ts'

test('beta preferences persist and reject arbitrary repositories and intervals', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'viralcut-beta-settings-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const settings = await betaSettings(folder)
  assert.equal(settings.read().interval, 5)
  const value = { interval: 15, repository: 'example/private-repo', language: 'en' }
  await settings.save(value)
  assert.deepEqual((await betaSettings(folder)).read(), value)
  assert.throws(() => settings.save({ ...value, repository: 'https://example.com/abc' }), /invalidSettings/)
  assert.throws(() => settings.save({ ...value, interval: 1 }), /invalidSettings/)
  assert.throws(() => settings.save({ ...value, repository: 'example/..' }), /invalidSettings/)
})

test('release checks sort beta and stable tags, skip drafts and return plain notes', async () => {
  const result = await checkGitHubRelease('example/app', '18.1.0-beta', (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/example/app/releases?per_page=30')
    assert.equal(options.redirect, 'error')
    return Response.json([{ tag_name: 'v19.0.0', draft: true }, { tag_name: 'v18.1.0-beta.2', draft: false },
      { tag_name: 'v18.1-beta', draft: false }, { tag_name: 'v18.1.0', body: '<script>text</script>', draft: false }])
  })
  assert.deepEqual(result, { state: 'available', tag: 'v18.1.0', notes: '<script>text</script>' })
  assert.deepEqual(await checkGitHubRelease('example/app', '18.1.0-beta', () =>
    Response.json([{ tag_name: 'v18.1-beta', draft: false }])), { state: 'current' })
})

test('release checks distinguish offline, rate limit and inaccessible private releases', async () => {
  for (const [status, state] of [[404, 'unavailable'], [429, 'limited'], [500, 'error']]) {
    assert.deepEqual(await checkGitHubRelease('example/app', '18.1.0-beta', () => new Response(null, { status })), { state })
  }
  assert.deepEqual(await checkGitHubRelease('example/app', '18.1.0-beta', () => { throw Error('network') }), { state: 'offline' })
  assert.deepEqual(await checkGitHubRelease('', '18.1.0-beta', () => assert.fail('unexpected fetch')), { state: 'unconfigured' })
})

test('release checks bound the actual decoded response and reject invalid repositories', async () => {
  let cancelled = false
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)) },
    cancel() { cancelled = true } })
  assert.deepEqual(await checkGitHubRelease('example/app', '18.1.0-beta', () => new Response(body)), { state: 'error' })
  assert.equal(cancelled, true)
  assert.deepEqual(await checkGitHubRelease('example/..', '18.1.0-beta', () => assert.fail('unexpected fetch')), { state: 'unconfigured' })
})

test('unclean exit is included in a local report containing only redacted diagnostic fields', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'viralcut-beta-report-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const diag = await createDiagnostics(folder)
  await startSessionMarker(folder, diag.record)
  const markClean = await startSessionMarker(folder, diag.record)
  diag.record('export', 'failed', undefined, 'C:\\private\\video name.mp4')
  const path = join(folder, 'report.json')
  await saveDiagnosticReport(path, '18.1.0-beta', diag)
  const text = await readFile(path, 'utf8')
  assert.ok(!text.includes('private'))
  assert.deepEqual(JSON.parse(text).entries.map(entry => entry.code), ['unknown', 'uncleanExit'])
  await markClean()
  const clean = await startSessionMarker(folder, diag.record)
  assert.equal(diag.entries().length, 2)
  await clean()
  await diag.settled()
})

test('damaged recovery falls back to previous checkpoint or v18 without modifying v18', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'viralcut-beta-recover-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const current = join(folder, 'recovery.viralcut')
  const old = join(folder, 'old.viralcut')
  const state = { version: 1, media: [], clips: [], appearance: defaultAppearance, encoder: 'auto', burn: true,
    profile: { resolution: 1080, fps: 30, bitrate: 0, quality: 'balanced' } }
  await writeFile(old, JSON.stringify(state))
  const store = createProjectStore(current, old)
  assert.deepEqual(await store.recovery(), { available: true, damaged: false, fallback: true })
  await store.autosave(state)
  await store.autosave({ ...state, burn: false })
  assert.equal((await store.recover()).burn, false)
  await writeFile(current, '{')
  assert.equal((await store.recover()).burn, true)
  assert.equal((await store.recovery()).fallback, true)
  assert.equal(await readFile(old, 'utf8'), JSON.stringify(state))
  assert.equal((await createProjectStore(join(folder, 'absent')).recovery()).available, false)
})

test('indexed preview finds overlapping and unsorted cues in original order at exact boundaries', () => {
  const cues = [{ start: 3, end: 8, text: 'üç' }, { start: 0, end: 4, text: 'sıfır' },
    { start: 3.5, end: 4, text: '  ' }, { start: 3.5, end: 7, text: 'örtüşen' }]
  const lookup = createCueLookup(cues)
  for (const value of [0, 2, 3, 3.5, 4, 7, 8, 10]) {
    assert.deepEqual(lookup(value), cues.filter(cue => cue.text.trim() && cue.start <= value && value < cue.end))
  }
})
