import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { preview } from 'vite'

let samples
let server
let address
const output = process.env.VIRALCUT_SCREENSHOTS

function makeVideo(name, source, duration, outputArgs, inputArgs = []) {
  const path = join(samples, name)
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source,
    ...inputArgs, '-t', String(duration), ...outputArgs, path,
  ], { windowsHide: true, timeout: 30000 })
  return path
}

let mp4
let webm
let longVideo
before(async () => {
  samples = await mkdtemp(join(tmpdir(), 'viralcut-e2e-'))
  mp4 = makeVideo('sample.mp4', 'testsrc2=s=640x360:r=24', 8, [
    '-c:a', 'aac', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  ], ['-f', 'lavfi', '-i', 'sine=frequency=440'])
  webm = makeVideo('portrait.webm', 'testsrc2=s=360x640:r=24', 6, ['-c:v', 'libvpx-vp9', '-deadline', 'realtime'])
  longVideo = makeVideo('hour.mp4', 'color=c=0x263325:s=640x360:r=10', 3600, [
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-movflags', '+faststart',
  ])
  if (output) await mkdir(output, { recursive: true })
  server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } })
  address = 'http://127.0.0.1:' + server.httpServer.address().port
})

after(async () => {
  if (server) await new Promise(resolve => server.httpServer.close(resolve))
  if (samples) await rm(samples, { recursive: true, force: true })
})

for (const channel of (process.env.VIRALCUT_TEST_BROWSERS ?? 'msedge').split(',')) {
  test(channel + ' · video editor workflow', { timeout: 45000 }, async () => {
    const browser = await chromium.launch({ channel })
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const errors = []
      const remote = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => {
        if (route.request().url().startsWith(address + '/')) return route.continue()
        remote.push(route.request().url())
        return route.abort()
      })
      await page.goto(address)
      await page.getByRole('heading', { name: 'Bir video ekle' }).waitFor()
      if (output) await page.screenshot({ path: join(output, channel + '-desktop.png'), fullPage: true })

      const upload = page.locator('input[type=file]')
      const choose = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Dosya seç' }).click()
      await (await choose).setFiles(mp4)
      await page.getByText('640 × 360', { exact: true }).waitFor()
      assert.equal(await page.locator('video').getAttribute('preload'), 'metadata')
      await page.getByRole('button', { name: 'Oynat', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('video').currentTime > 0.25)
      await page.getByRole('button', { name: 'Duraklat', exact: true }).click()
      assert.equal(await page.locator('video').evaluate(video => video.paused), true)
      await page.locator('button:focus').evaluate(button => button.blur())
      await page.keyboard.press('Space')
      await page.getByRole('button', { name: 'Duraklat', exact: true }).waitFor()
      await page.keyboard.press('Space')
      await page.getByRole('button', { name: 'Oynat', exact: true }).waitFor()

      const seek = page.getByRole('slider', { name: 'Oynatma konumu' })
      await seek.press('Home')
      await seek.press('ArrowRight')
      assert.equal(await seek.inputValue(), '1')
      const start = page.getByRole('textbox', { name: 'Başlangıç (sn)' })
      const end = page.getByRole('textbox', { name: 'Bitiş (sn)' })
      await page.getByRole('button', { name: 'Konumu başlangıç yap' }).click()
      assert.equal(await start.inputValue(), '1')
      await end.fill('5,5')
      await end.press('Enter')
      assert.equal(await end.inputValue(), '5.5')
      await page.getByText('00:00:04.500', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Bitişe git' }).click()
      assert.equal(await seek.inputValue(), '5.5')
      await start.fill('6')
      await start.press('Enter')
      await page.getByRole('alert').getByText(/Başlangıç, bitişten önce/).waitFor()
      assert.equal(await start.inputValue(), '1')
      await page.getByRole('button', { name: 'Sıfırla' }).click()
      assert.equal(await end.inputValue(), '8')
      await seek.click({ position: { x: Math.floor((await seek.boundingBox()).width * .6), y: 12 } })
      assert.ok(Math.abs(Number(await seek.inputValue()) - 4.8) < .1)

      const handle = await page.locator('.trim-handle.start').boundingBox()
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + 180, handle.y + handle.height / 2, { steps: 5 })
      await page.mouse.up()
      assert.ok(Number(await start.inputValue()) > .5)

      for (const [label, style] of [['Vurgu', 'bold'], ['Kutulu', 'box'], ['Klasik', 'classic']]) {
        const button = page.getByRole('button', { name: label, exact: true })
        await button.click()
        assert.equal(await button.getAttribute('aria-pressed'), 'true')
        await page.locator('.stage-caption.' + style).waitFor()
      }
      await page.getByRole('checkbox', { name: 'Örnek altyazıyı göster' }).uncheck()
      assert.equal(await page.locator('.stage-caption').count(), 0)
      await page.getByRole('checkbox', { name: 'Örnek altyazıyı göster' }).check()
      await page.getByRole('button', { name: 'Sesi kapat' }).click()
      assert.equal(await page.locator('video').evaluate(video => video.muted), true)
      await page.getByRole('button', { name: 'English' }).click()
      await page.getByRole('heading', { name: 'Local workspace' }).waitFor()
      assert.equal(await page.locator('html').getAttribute('lang'), 'en')

      await page.setViewportSize({ width: 390, height: 844 })
      const drop = await page.evaluateHandle(bytes => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([Uint8Array.from(bytes)], 'portrait.webm', { type: 'video/webm' }))
        return transfer
      }, [...await readFile(webm)])
      await page.locator('.stage').dispatchEvent('drop', { dataTransfer: drop })
      await drop.dispose()
      await page.getByText('360 × 640', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Play', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('video').currentTime > 0.25)
      await page.getByRole('button', { name: 'Pause' }).click()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390)
      if (output) await page.screenshot({ path: join(output, channel + '-mobile.png'), fullPage: true })
      await page.setViewportSize({ width: 320, height: 700 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320)

      await upload.setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('text') })
      await page.getByRole('alert').getByText(/MP4 or WebM extension/).waitFor()
      await page.getByText('360 × 640', { exact: true }).waitFor()
      await upload.setInputFiles({ name: 'empty.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(0) })
      await page.getByRole('alert').getByText(/file is empty/).waitFor()
      await upload.setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('invalid video') })
      await page.getByRole('alert').getByText(/Could not open this video/).waitFor()

      await upload.setInputFiles(longVideo)
      await page.getByRole('complementary').getByText('01:00:00.000', { exact: true }).waitFor()
      await page.getByRole('slider', { name: 'Playback position' }).press('End')
      await page.waitForFunction(() => document.querySelector('video').currentTime === 3600)
      await page.reload()
      await page.getByRole('heading', { name: 'Local workspace' }).waitFor()
      assert.deepEqual(errors, [])
      assert.deepEqual(remote, [])
    } finally {
      await browser.close()
    }
  })
}
