import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { layoutDefaults, openWorkspace, validateLayout } from '../desktop/workspace.mjs'

test('workspace clamps panel limits and ignores invalid values', () => {
  assert.deepEqual(validateLayout({ left: 800, right: -1, timeline: 286, library: false, theme: 'light', tracks: 'hide' }),
    { ...layoutDefaults, left: 408, right: 215, timeline: 286, library: false, theme: 'light' })
})

test('workspace preferences and recent project IDs survive reopening without exposing source paths', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'viralcut-workspace-doc-'))
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 4 }))
  const project = join(directory, 'Editing.viralcut')
  await writeFile(project, '{}')
  const workspace = await openWorkspace(directory)
  await workspace.remember(project)
  await workspace.remember(project)
  await workspace.save({ theme: 'light', left: 300, inspector: false })
  const reopened = await openWorkspace(directory)
  const state = reopened.read()
  assert.equal(state.layout.theme, 'light')
  assert.equal(state.layout.left, 300)
  assert.equal(state.layout.inspector, false)
  assert.equal(state.recent.length, 1)
  assert.deepEqual(Object.keys(state.recent[0]), ['id', 'name'])
  assert.equal(state.recent[0].name, 'Editing.viralcut')
  assert.equal(reopened.path(state.recent[0].id), project)
  assert.equal(reopened.path('../Editing.viralcut'), undefined)
})
