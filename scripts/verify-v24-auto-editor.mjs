import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const [input, executable, screenshotDir] = process.argv.slice(2)
if (!input) throw Error('Usage: node scripts/verify-v24-auto-editor.mjs <speech MP4> [Electron EXE] [screenshot directory]')
const root = resolve(import.meta.dirname, '..')
const temp = await mkdtemp(join(tmpdir(), 'viralcut-v24-ui-'))
const project = join(temp, 'Timeline.viralcut')
const output = join(temp, 'Timeline.mp4')
const profile = join(temp, 'profile')
const errors = []
let app, page
async function start() {
  app = await _electron.launch({ executablePath: executable || join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [...(executable ? [] : [root]), '--user-data-dir=' + profile], timeout: 60000 })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.locator('.studio').waitFor()
}
async function dialogs(open, save) {
  await app.evaluate(({ dialog }, fixture) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture.open] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: fixture.save })
    dialog.showMessageBox = async () => ({ response: 0 })
  }, { open, save })
}
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
async function screenshot(name) {
  if (!screenshotDir) return
  await mkdir(screenshotDir, { recursive: true })
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const shot = await BrowserWindow.getAllWindows()[0].capturePage()
    return shot.toPNG().toString('base64')
  })
  assert.ok(png.length > 100)
  await writeFile(join(screenshotDir, name), Buffer.from(png, 'base64'))
}
async function quit() {
  const closed = app.waitForEvent('close', { timeout: 30000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  app = undefined
}
try {
  await start()
  await dialogs(resolve(input), project)
  await button('AI Stüdyo').click()
  const studio = page.getByRole('region', { name: 'Tek Tıkla Shorts' })
  await button('Shorts için video seç', studio).click()
  await studio.getByRole('spinbutton', { name: 'Hedef klip süresi' }).fill('23')
  const analyze = button('AI ile Videomu Düzenle', studio)
  await analyze.click()
  await studio.locator('.export-progress button').click()
  await studio.locator('.export-progress').waitFor({ state: 'hidden', timeout: 60000 })
  const started = performance.now()
  await analyze.click()
  const approve = button('Planı onayla ve zaman çizelgesine ekle', studio)
  await approve.waitFor({ timeout: 360000 })
  assert.ok(await studio.locator('.semantic-details').filter({ hasText: '/100' }).count())
  const analysisMs = Math.round(performance.now() - started)
  const rows = studio.locator('article > .auto-card-head input')
  for (let i = 1; i < await rows.count(); i++) await rows.nth(i).uncheck()
  await rows.first().check()
  await screenshot('v24-plan.png')
  await approve.click()
  const timeline = page.locator('.layer-scroll')
  const video = timeline.locator('[data-kind=video] .layer-clip')
  await video.first().waitFor()
  await timeline.locator('[data-kind=audio] .layer-clip').first().waitFor()
  await page.locator('.layer-scroll [data-kind=caption] .layer-clip').first().waitFor()
  await button('Geri al', page.locator('.layer-editor')).click()
  assert.equal(await video.count(), 0)
  await button('Yeniden yap', page.locator('.project-panel')).click()
  await video.first().waitFor()
  await button('Projeyi kaydet').click()
  await page.getByText('Kaydedildi Timeline.viralcut', { exact: true }).waitFor()
  const saved = JSON.parse(await readFile(project, 'utf8'))
  assert.equal(saved.version, 4)
  const render = performance.now()
  await button('Buradan 8 sn önizle').click()
  await page.locator('.layer-monitor video').waitFor({ timeout: 120000 })
  const previewMs = Math.round(performance.now() - render)
  await screenshot('v24-timeline.png')
  await button('Kapat', page.locator('.layer-monitor')).click()
  await dialogs(project, output)
  const exportStart = performance.now()
  await button('Katmanları MP4 hazırla').click()
  await button('Proje MP4 dosyasını kaydet').click({ timeout: 180000 })
  await page.getByText('Kaydedildi Timeline.mp4', { exact: true }).waitFor()
  const exportMs = Math.round(performance.now() - exportStart)
  const info = JSON.parse(execFileSync(process.env.VIRALCUT_FFPROBE ?? 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output],
    { windowsHide: true }))
  const [picture, audio] = ['video', 'audio'].map(kind => info.streams.find(stream => stream.codec_type === kind))
  const driftMs = 1000 * Math.abs(+picture.duration - +audio.duration)
  assert.deepEqual([picture.width, picture.height, picture.codec_name, audio.codec_name], [1080, 1920, 'h264', 'aac'])
  assert.ok(driftMs < 50)
  await quit()
  await start()
  await dialogs(project, output)
  await button('Proje aç').click()
  await page.locator('.layer-scroll [data-kind=caption] .layer-clip').first().waitFor()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ analysisMs, previewMs, exportMs, outputSeconds: +picture.duration, driftMs,
    frames: +picture.nb_frames, tracks: saved.timeline.tracks.map(track => [track.kind, track.clips.length]) }))
  await quit()
} finally {
  await app?.close().catch(() => {})
  await rm(temp, { recursive: true, force: true, maxRetries: 5 })
}
