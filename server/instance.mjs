import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const directory = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const key = process.platform === 'win32' ? directory.toLowerCase() : directory

// The identity ties a running server to this checkout and this launcher protocol.
export const instanceId = createHash('sha256').update('viralcut-v3-local-startup\n' + key).digest('hex')
