import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDiagnostics } from '../desktop/diagnostics.mjs'

test('local diagnostics persists bounded, allowlisted records without paths or engine output', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'viralcut-logs-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const sink = await createDiagnostics(folder)
  for (let index = 0; index < 140; index++) sink.record('export', 'ready', performance.now())
  const privateText = 'C:\\private\\local video.mp4'
  sink.record(privateText, 'failed', 0, 'ENOSPC')
  sink.record('transcribe', 'failed', performance.now(), privateText)
  sink.record('save-clip', 'failed', performance.now(), 'accessDenied')
  await sink.settled()
  const content = await readFile(join(folder, 'diagnostics.json'), 'utf8')
  assert.equal(content.includes('private'), false)
  const recovered = (await createDiagnostics(folder)).entries()
  assert.equal(recovered.length, 120)
  assert.equal(recovered[0].code, 'accessDenied')
  assert.equal(recovered[1].code, 'unknown')
})
