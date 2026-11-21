import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const temp = await mkdtemp(join(tmpdir(), 'viralcut-v23-ui-'))
const media = join(temp, 'Studio sample.mp4')
const project = join(temp, 'Workspace.viralcut')
const profile = join(temp, 'profile')
const screenshotDir = process.env.VIRALCUT_SCREENSHOTS
const executable = process.argv[2]
execFileSync(process.env.VIRALCUT_FFMPEG ?? 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30',
  '-f', 'lavfi', '-i', 'sine=frequency=700', '-t', '8', '-c:v', 'libx264', '-threads:v', '2', '-c:a', 'aac', media], { windowsHide: true })
let app, page
const errors = []
async function start() {
  app = await _electron.launch({ executablePath: executable || join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [...(executable ? [] : [root]), '--user-data-dir=' + profile], timeout: 45000 })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.locator('.studio').waitFor()
}
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
async function quit() {
  const closed = app.waitForEvent('close', { timeout: 16000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  app = undefined
}
try {
  await start()
  await app.evaluate(({ dialog }, fixtures) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixtures.media] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: fixtures.project })
    dialog.showMessageBox = async () => ({ response: 0 })
  }, { media, project })
  await button('Projeye video ekle').click()
  await page.locator('.sequence-strip button').first().waitFor()
  await button('Profesyonel Editör').click()
  await page.locator('.layer-scroll').waitFor()
  await button('Zaman çizelgesine sığdır').click()
  const timeline = page.locator('.layer-scroll')
  await timeline.focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('spinbutton', { name: 'İmleç karesi', exact: true }).inputValue(), '1')
  await page.keyboard.press('f')
  for (const [width, height] of [[1366, 768], [1920, 1080]]) for (const zoom of [1, 1.25, 1.5]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setContentSize(size.width, size.height)
      window.webContents.setZoomFactor(size.zoom)
    }, { width, height, zoom })
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth)
    assert.ok(await timeline.isVisible())
    assert.ok(await button('Profesyonel Editör').isVisible())
  }
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.webContents.setZoomFactor(1)
    window.setContentSize(1366, 768)
  })
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true })
    await page.waitForFunction(() => document.querySelector('.media-thumb')?.naturalWidth > 0)
    await page.screenshot({ path: join(screenshotDir, 'v23-editor.png') })
  }
  await button('Projeyi kaydet').click()
  await page.getByText('Kaydedildi Workspace.viralcut', { exact: true }).waitFor()
  const visual = JSON.parse(await readFile(project, 'utf8'))
  assert.equal(visual.version, 2)
  await button('Projeler').click()
  const hub = page.getByRole('region', { name: 'Proje merkezi' })
  await button('Workspace.viralcut', hub).waitFor()
  await hub.getByRole('searchbox').fill('unmatched')
  assert.equal(await button('Workspace.viralcut', hub).count(), 0)
  await hub.getByRole('searchbox').fill('work')
  await button('Workspace.viralcut', hub).click()
  await hub.getByText('Proje açıldı.', { exact: true }).waitFor()
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'v23-project-hub.png') })
  await button('AI Stüdyo').click()
  await page.getByRole('navigation', { name: 'AI araçları' }).waitFor()
  await button('Kolay Editör').click()
  await page.locator('.sequence-strip button').first().waitFor()
  await button('Profesyonel Editör').click()
  assert.ok(await timeline.isVisible())
  await button('+ Video', page.locator('.layer-editor')).click()
  await page.locator('.layer-label').filter({ hasText: 'V2' }).waitFor()
  await button('Projeler').click()
  await button('Yeni proje', hub).click()
  await page.locator('.layer-label').filter({ hasText: 'V2' }).waitFor()
  await button('Geri al', page.locator('.layer-editor')).click()
  const left = page.locator('.studio-split.left').getByRole('separator')
  await left.focus()
  await page.keyboard.press('ArrowRight')
  const width = await left.getAttribute('aria-valuenow')
  assert.equal(width, '298')
  await page.locator('.layout-menu summary').click()
  await page.getByRole('combobox', { name: 'Tema' }).selectOption('light')
  await page.locator('.layout-popover').getByRole('checkbox', { name: 'Ayarlar' }).uncheck()
  assert.equal(await page.locator('.inspector').isVisible(), false)
  await button('English').click()
  await page.waitForFunction(() => document.documentElement.lang === 'en')
  await quit()

  await start()
  await button('Professional Editor').waitFor()
  await page.locator('.studio[data-theme=light][data-inspector=false]').waitFor()
  assert.equal(await page.locator('.studio-split.left [role=separator]').getAttribute('aria-valuenow'), width)
  await button('Projects').click()
  await button('Workspace.viralcut', page.getByRole('region', { name: 'Project hub' })).click()
  await page.locator('.layer-scroll').waitFor()
  assert.deepEqual(errors, [])
  console.log('Workspace, panel keyboard resizing, three zoom factors, editor switching, theme, language and recent project reopening passed.')
  await quit()
} finally {
  await app?.close().catch(() => {})
  await rm(temp, { recursive: true, force: true, maxRetries: 5 })
}
