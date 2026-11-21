import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'viralcut-v22-ui-'))
const media = join(directory, 'action.mp4')
const silent = join(directory, 'silent.mp4')
const project = join(directory, 'timeline.viralcut')
const output = join(directory, 'timeline.mp4')
const profile = join(directory, 'profile')
const ff = (tool, args) => execFileSync(process.env[tool === 'ffmpeg' ? 'VIRALCUT_FFMPEG' : 'VIRALCUT_FFPROBE'] ?? tool,
  args, { windowsHide: true, timeout: 45000, maxBuffer: 2 ** 20 })
ff('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-f', 'lavfi', '-i', 'sine=frequency=662',
  '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads:v', '2', '-c:a', 'aac', media])
ff('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-t', '20',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-threads:v', '2', silent])
const executable = process.argv[2]
let app, page
const errors = []
async function launch() {
  const started = performance.now()
  app = await _electron.launch({ executablePath: executable || join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [...(executable ? [] : [root]), '--user-data-dir=' + profile], timeout: 45000 })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: 'Profesyonel Editör', exact: true }).waitFor()
  console.log('Editor startup ms', Math.round(performance.now() - started))
}
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const dialogs = (file, save) => app.evaluate(({ dialog }, names) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [names.file] })
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: names.save })
}, { file, save })
const playhead = frame => page.getByRole('spinbutton', { name: 'İmleç karesi', exact: true }).fill(String(frame))
const monitor = () => page.locator('.layer-monitor video')
const ready = () => page.waitForFunction(() => document.querySelector('.layer-monitor video')?.readyState >= 2, undefined, { timeout: 45000 })
const measure = async name => {
  const started = performance.now()
  await button(name).click()
  await ready()
  return Math.round(performance.now() - started)
}
async function close() {
  const gone = app.waitForEvent('close', { timeout: 15000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await gone
  app = undefined
}

try {
  await launch()
  await dialogs(media, project)
  await button('Projeye video ekle').click()
  const source = page.locator('.main-video')
  await page.waitForFunction(() => document.querySelector('.main-video')?.readyState > 0)
  await page.getByRole('combobox', { name: 'Proxy çözünürlüğü' }).selectOption('540')
  await page.getByRole('combobox', { name: 'Proxy kodlayıcı' }).selectOption('cpu')
  await button('Hafif önizleme oluştur').click()
  const light = button('Hafif önizleme · 540p')
  await light.waitFor({ timeout: 45000 })
  await source.evaluate(video => { video.currentTime = 4 })
  await page.waitForFunction(() => document.querySelector('.main-video')?.currentTime >= 3.95)
  await light.click()
  await page.waitForFunction(() => {
    const video = document.querySelector('.main-video')
    return video?.videoHeight === 540 && Math.abs(video.currentTime - 4) < .1
  })
  await button('Orijinal önizleme').click()
  await page.waitForFunction(() => document.querySelector('.main-video')?.videoHeight === 720)
  await page.locator('.studio-tools').getByRole('button', { name: 'Ses', exact: true }).click()
  const audioStudio = page.getByRole('region', { name: 'Ses Stüdyosu' })
  await button('Seçili aralıkta ses ölç', audioStudio).click()
  await audioStudio.locator('dd').filter({ hasText: /\d LUFS$/ }).waitFor({ timeout: 45000 })
  await button('Konuşmayı dengele', audioStudio).click()
  await button('Özgün sesi geri yükle', audioStudio).click()

  await button('Profesyonel Editör').click()
  await page.getByRole('combobox', { name: 'Önizleme kaynağı' }).selectOption('540')
  await page.getByRole('combobox', { name: 'Önizleme süresi' }).selectOption('4')
  await playhead(40)
  const cold = await measure('Buradan 4 sn önizle')
  assert.ok(await page.getByText('Proxy kaynakları 1', { exact: true }).isVisible())
  await playhead(60)
  await page.waitForFunction(() => Math.abs((document.querySelector('.layer-monitor video')?.currentTime ?? 0) - 20 / 30) < .06)
  await monitor().evaluate(video => video.play())
  await page.waitForFunction(() => (document.querySelector('.layer-monitor video')?.currentTime ?? 0) > 2)
  const playback = await monitor().evaluate(video => {
    video.pause()
    const { totalVideoFrames, droppedVideoFrames } = video.getVideoPlaybackQuality()
    return { totalVideoFrames, droppedVideoFrames, seconds: video.currentTime }
  })
  await button('Kapat', page.locator('.layer-monitor')).click()
  await playhead(200)
  await measure('Buradan 4 sn önizle')
  await button('Kapat', page.locator('.layer-monitor')).click()
  await playhead(40)
  const cached = await measure('Buradan 4 sn önizle')
  await page.getByText('Önbellekten', { exact: true }).waitFor()
  console.log('Renderer preview', JSON.stringify({ cold, cached, ...playback }))
  await button('Kapat', page.locator('.layer-monitor')).click()
  await button('Projeyi kaydet').click()
  await page.getByText('Kaydedildi timeline.viralcut', { exact: true }).waitFor()
  await dialogs(project, output)
  await button('Katmanları MP4 hazırla').click()
  await button('Proje MP4 dosyasını kaydet').click({ timeout: 120000 })
  await page.getByText('Kaydedildi timeline.mp4', { exact: true }).waitFor()
  assert.equal(JSON.parse(await readFile(project, 'utf8')).version, 2)
  const info = JSON.parse(ff('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,nb_frames,duration',
    '-of', 'json', output]))
  assert.deepEqual(info.streams.map(stream => stream.codec_name), ['h264', 'aac'])
  assert.equal(Number(info.streams[0].nb_frames), 600)
  assert.ok(Math.abs(Number(info.streams[0].duration) - Number(info.streams[1].duration)) < .04)
  console.log('Full timeline output', JSON.stringify(info))
  await button('Kolay Editör').click()
  await page.locator('.sequence-strip button').first().waitFor()
  await button('AI Stüdyo').click()
  assert.ok(await page.getByRole('region', { name: 'Tek Tıkla Shorts' }).isVisible())
  await button('Profesyonel Editör').click()
  await page.locator('[data-kind=video] button').first().waitFor()
  await close()

  await launch()
  await dialogs(project, output)
  await button('Proje aç').click()
  await page.locator('[data-kind=video] button').first().waitFor()
  await page.getByRole('combobox', { name: 'Proxy çözünürlüğü' }).selectOption('540')
  const persisted = button('Hafif önizleme · 540p')
  await persisted.waitFor({ timeout: 15000 })
  const cache = join(profile, 'proxy-cache-v1')
  for (const file of await readdir(cache)) if (/^[a-f0-9]{64}\.mp4$/.test(file)) await unlink(join(cache, file))
  await persisted.click()
  await page.getByText('Proxy bulunamadı. Özgün video açıldı.', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.main-video')?.videoHeight === 720)
  await button('AI Stüdyo').click()
  const shorts = page.getByRole('region', { name: 'Tek Tıkla Shorts' })
  await dialogs(silent, output)
  await button('Shorts için video seç', shorts).click()
  await shorts.getByRole('combobox', { name: 'Hedef klip süresi' }).selectOption('15')
  await button('Analiz et', shorts).click()
  await button('Seçilenleri Kolay Editöre ekle', shorts).click({ timeout: 120000 })
  await page.locator('.sequence-strip button').nth(1).waitFor()
  const panel = page.locator('.project-panel')
  await button('Geri al', panel).click()
  assert.equal(await page.locator('.sequence-strip button').count(), 1)
  await button('Yeniden yap', panel).click()
  assert.equal(await page.locator('.sequence-strip button').count(), 2)
  console.log('Selected clip transferred from analyzed source and survived Undo/Redo')
  assert.deepEqual(errors, [])
  await close()
} finally {
  await app?.close().catch(() => {})
  await rm(directory, { recursive: true, force: true, maxRetries: 5 })
}
