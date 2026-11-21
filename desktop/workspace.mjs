import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { atomic } from './beta.mjs'
import { localPath } from './projects.mjs'

export const layoutDefaults = { left: 282, right: 255, timeline: 300, library: true, inspector: true, tracks: true, theme: 'dark' }
export function validateLayout(value) {
  const result = { ...layoutDefaults }
  for (const [key, min, max] of [['left', 222, 408], ['right', 215, 375], ['timeline', 220, 495]]) {
    if (Number.isInteger(value?.[key])) result[key] = Math.max(min, Math.min(max, value[key]))
  }
  for (const key of ['library', 'inspector', 'tracks']) if (typeof value?.[key] === 'boolean') result[key] = value[key]
  if (value?.theme === 'light') result.theme = value.theme
  return result
}
const validPath = path => localPath(path) && extname(path).toLowerCase() === '.viralcut'
export async function openWorkspace(folder) {
  const file = join(folder, 'workspace-v23.json')
  let state = { layout: { ...layoutDefaults }, recent: [] }
  try {
    if ((await stat(file)).size < 256 * 1024) {
      const raw = JSON.parse(await readFile(file, 'utf8'))
      state = { layout: validateLayout(raw.layout), recent: Array.isArray(raw.recent) ?
        raw.recent.filter(row => /^[\da-f-]{36}$/.test(row?.id) && validPath(row?.path)).slice(0, 20) : [] }
    }
  } catch { /* First run or unreadable preferences. */ }
  let pending = Promise.resolve()
  function persist() {
    const snapshot = state
    const writing = pending.then(() => atomic(file, snapshot))
    pending = writing.catch(() => {})
    return writing
  }
  return {
    read: () => ({ layout: state.layout, recent: state.recent.map(({ id, path }) => ({ id, name: basename(path) })) }),
    path: id => typeof id === 'string' && state.recent.find(row => row.id === id)?.path,
    save(layout) { state = { ...state, layout: validateLayout(layout) }; return persist() },
    remember(path) {
      if (!validPath(path)) return
      const entries = state.recent.filter(row => row.path.toLowerCase() !== path.toLowerCase())
      const previous = state.recent.find(row => row.path.toLowerCase() === path.toLowerCase())
      state = { ...state, recent: [{ id: previous?.id ?? randomUUID(), path }, ...entries].slice(0, 20) }
      return persist()
    },
    settled: () => pending,
  }
}
