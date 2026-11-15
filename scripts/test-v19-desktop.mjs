import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { _electron } from 'playwright'

const work = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = await mkdtemp(join(tmpdir(), 'viralcut-v19-desktop-'))
const ff = (name, args) => execFileSync(
  (name === 'ffmpeg' ? process.env.VIRALCUT_FFMPEG : process.env.VIRALCUT_FFPROBE) ?? name, args,
  { windowsHide: true, maxBuffer: 8000000, timeout: 30000 },
)
const blue = join(dir,'blue.mp4')
const red = join(dir,'red.mp4')
const tone = join(dir,'tone.wav')
const projectFile = join(dir,'test.viralcut')
const output = join(dir,'output.mp4')
ff('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=640x360:r=30','-f','lavfi','-i','sine=frequency=440',
  '-t','4','-c:v','libx264','-threads','2','-c:a','aac',blue])
ff('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=640x360:r=30','-t','2','-c:v','libx264','-threads','2',red])
ff('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=910:sample_rate=48000','-t','2',tone])

const executable = process.argv[2]
const config = {
  executablePath: executable || resolve(work, 'node_modules/electron/dist/electron.exe'),
  args: [...(executable ? [] : [work]), '--user-data-dir=' + join(dir,'profile')],
  timeout: 45000,
}
async function launch() {
  const app = await _electron.launch(config)
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  return { app, page, errors }
}
let { app, page, errors } = await launch()
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const native = (files, savePath) => app.evaluate(({ dialog }, data) => {
  dialog.showOpenDialog = async () => ({ canceled:false, filePaths:data.files })
  dialog.showSaveDialog = async () => ({ canceled:false, filePath:data.savePath })
}, { files, savePath })
const clip = (kind, name) => button(name, page.locator(`[data-kind="${kind}"]`))
const field = async (label, value) => {
  const element = page.getByRole('spinbutton', { name: label, exact:true })
  await element.fill(String(value))
  await element.press('Enter')
}
const quit = async () => {
  const done = app.waitForEvent('close', { timeout: 25000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await done
}
try {
  await native([blue, red], projectFile)
  await button('Projeye video ekle').click()
  await page.locator('.sequence-strip button').nth(1).waitFor()
  await button('Katmanlı düzen').click()
  await button('+ Video').click()
  await field('İmleç karesi', 30)
  await page.getByRole('combobox', { name: 'Katmana eklenecek medya' }).selectOption({ label: 'red.mp4' })
  await button('İmlece ekle').click()
  await clip('video','red.mp4').first().waitFor()
  const top = page.locator('[data-kind="video"]').first()
  const pip = button('red.mp4', top)
  await pip.click()
  await field('Ölçek %', 50)
  await field('X %', 100)
  await field('Y %', 0)
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.layer-thumb')).some(img => img.naturalWidth === 96))
  const box = await pip.boundingBox()
  await page.mouse.move(box.x + 12, box.y + 12); await page.mouse.down()
  await page.mouse.move(box.x + 30, box.y + 12, { steps: 5 }); await page.mouse.up()
  const position = page.getByRole('spinbutton', { name: 'Konum · kare', exact:true })
  const moved = Number(await position.inputValue())
  assert.ok(moved > 30)
  await field('İmleç karesi', moved + 20)
  await button('Böl').click()
  assert.equal(await button('red.mp4', top).count(), 2)
  await button('Geri al', page.locator('.layer-editor')).click()
  assert.equal(await button('red.mp4', top).count(), 1)
  await native([tone], projectFile)
  await button('Ses dosyası ekle').click()
  await page.locator('.studio-library').getByText('tone.wav', {exact:true}).waitFor()
  await button('+ Ses').click()
  await field('İmleç karesi', 0)
  await page.getByRole('combobox', { name:'Katmana eklenecek medya' }).selectOption({ label:'tone.wav' })
  await button('İmlece ekle').click()
  await clip('audio','tone.wav').click()
  await button('Dalga formu hazırla').click()
  await page.locator('.layer-wave').first().waitFor()
  await button('Buradan 8 sn önizle').click()
  const monitor = page.locator('.layer-monitor video')
  await monitor.waitFor({timeout: 45000})
  await monitor.evaluate(async video => { await video.play() })
  await page.waitForFunction(() => document.querySelector('.layer-monitor video')?.currentTime > .25)
  await monitor.evaluate(video => video.pause())
  await page.screenshot({ path:join(dir,'timeline.png') })
  await button('Kapat', page.locator('.layer-monitor')).click()
  await button('Projeyi kaydet').click()
  await page.getByText('Kaydedildi test.viralcut', { exact:true }).waitFor()
  const saved = JSON.parse(await readFile(projectFile,'utf8'))
  assert.equal(saved.version, 2)
  assert.equal(saved.timeline.tracks.find(track => track.name === 'V2').clips[0].scale, .5)
  await native([], output)
  await button('Katmanları MP4 hazırla').click()
  await button('Proje MP4 dosyasını kaydet').click({ timeout: 45000 })
  await page.getByText('Kaydedildi output.mp4', {exact:true}).waitFor()
  const info = ff('ffprobe',['-v','error','-show_entries','stream=codec_name,width,height,avg_frame_rate:format=duration','-of','json',output])
  assert.equal(JSON.parse(info).streams[0].codec_name,'h264')
  assert.equal(JSON.parse(info).streams[1].codec_name,'aac')
  console.log('Native UI export',info.toString())
  assert.deepEqual(errors,[])
  await quit()
  const reopened = await launch()
  app = reopened.app; page = reopened.page; errors = reopened.errors
  await native([projectFile], projectFile)
  await button('Proje aç').click()
  await button('red.mp4', page.locator('[data-kind="video"]').first()).waitFor()
  await clip('audio','tone.wav').waitFor()
  console.log('Reloaded v2 without page errors', errors.length)
  const big = JSON.parse(JSON.stringify(saved))
  big.clips = []
  const seed = big.timeline.tracks[0].clips[0]
  big.timeline.tracks = Array.from({ length:20 }, (_, index) => ({
    ...big.timeline.tracks[0], id:crypto.randomUUID(), name:'V' + (index+1),
    clips:Array.from({length:25}, (_, i) => ({ ...seed, id:crypto.randomUUID(), at:i*2700+index*5, length:60 })),
  }))
  const large = join(dir,'large.viralcut')
  await writeFile(large, JSON.stringify(big))
  await native([large], large)
  const start = performance.now()
  await button('Proje aç').click()

  await page.locator('.layer-label').filter({hasText:'V20'}).waitFor()
  const openMs = performance.now() - start
  const sample = () => app.evaluate(({ app }) => app.getAppMetrics().map(({ pid, type, memory, cpu }) => ({ pid, type, memory, cpu })))
  const begin = await sample()
  const startScroll = performance.now()
  const runs = await page.locator('.layer-scroll').evaluate(async node => {
    const times = [], seen = []
    for (let i = 1; i <= 45; i++) {
      const time = performance.now()
      node.scrollLeft = node.scrollWidth * ((i * .17) % 1)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      times.push(performance.now() - time)
      seen.push(node.querySelectorAll('.layer-clip').length)
    }
    return { times, seen }
  })
  const end = await sample()
  const sampleSeconds = (performance.now() - startScroll) / 1000
  const cpuSeconds = end.reduce((sum, item) => sum + (item.cpu.cumulativeCPUUsage -
    (begin.find(entry => entry.pid === item.pid)?.cpu.cumulativeCPUUsage ?? item.cpu.cumulativeCPUUsage)), 0)
  const metrics = end.map(({ type, memory }) => ({ type, memory }))
  console.log('Large project', JSON.stringify({ openMs, renderedMax: Math.max(...runs.seen), samplesMs: runs.times,
    metrics, cpuSeconds, sampleSeconds }))
  await button('English').click()
  await button('Render layers to MP4').waitFor()
  assert.deepEqual(errors,[])
  console.log('Artifacts',dir)
} finally { await quit().catch(() => app.close()) }
