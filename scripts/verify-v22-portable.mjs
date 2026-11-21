import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const [executable, fixture] = process.argv.slice(2)
assert.ok(executable && fixture, 'Pass the Portable EXE and a local MP4')
const holder = createServer()
await new Promise(resolve => holder.listen(0, '127.0.0.1', resolve))
const port = holder.address().port
await new Promise(resolve => holder.close(resolve))
const directory = await mkdtemp(join(tmpdir(), 'viralcut-v22-portable-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^path$|^viralcut_|^electron_run_as_node$/i.test(key)))
env.Path = join(process.env.SystemRoot, 'System32') + ';' + process.env.SystemRoot
const child = spawn(resolve(executable), ['--remote-debugging-port=' + port, '--user-data-dir=' + directory],
  { env, cwd: directory, stdio: 'ignore', windowsHide: true })
const exit = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
exit.catch(() => {})
const chromeUrl = 'http://127.0.0.1:' + port
let browser, origin
try {
  const started = performance.now()
  const signal = AbortSignal.timeout(120000)
  while (!browser) {
    signal.throwIfAborted()
    if (child.exitCode !== null) throw Error('Portable exited early: ' + child.exitCode)
    const response = await fetch(chromeUrl + '/json/version', { signal: AbortSignal.timeout(500) }).catch(() => null)
    if (response?.ok) browser = await chromium.connectOverCDP(chromeUrl, { timeout: 4000 }).catch(() => undefined)
    if (!browser) await delay(300, undefined, { signal })
  }
  let page
  while (!page) {
    signal.throwIfAborted()
    page = browser.contexts()[0]?.pages().find(item => item.url().startsWith('http://127.0.0.1:'))
    if (!page) await delay(250, undefined, { signal })
  }
  await page.getByText('v22.0.0', { exact: true }).waitFor()
  console.log('Portable startup including extraction ms', Math.round(performance.now() - started))
  origin = new URL(page.url()).origin
  assert.equal((await fetch(origin)).status, 403)
  await page.locator('input[type=file]').first().setInputFiles(resolve(fixture))
  await page.waitForFunction(() => document.querySelector('.main-video')?.readyState > 0)
  await page.locator('.studio-tools').getByRole('button', { name: 'Efektler', exact: true }).click()
  await page.getByRole('button', { name: 'İşlenmiş örnek', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.fx-monitor')?.readyState >= 2, undefined, { timeout: 45000 })
  console.log('Processed MP4 preview played using bundled FFmpeg and no Node.js on the app PATH.')
} finally {
  if (browser) {
    const cdp = await browser.newBrowserCDPSession().catch(() => null)
    await cdp?.send('Browser.close').catch(() => {})
    await browser.close().catch(() => {})
  } else if (child.exitCode === null) child.kill()
  await Promise.race([exit.catch(() => {}), delay(8000)])
  await rm(directory, { recursive: true, force: true, maxRetries: 5 })
}
assert.ok(origin)
await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(3000) }))
console.log('Local service stopped.')
