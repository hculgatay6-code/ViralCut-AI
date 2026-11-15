import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, after, test } from 'node:test'
import { encodeClip, probe } from '../server/media.mjs'
import { analyzeSilence, validateEdit } from '../server/shorts.mjs'
import { preview } from 'vite'
import { chromium } from 'playwright'

const signal = new AbortController().signal
const settings = { threshold: -38, minimum: 0.7 }
let dir, source, silent
function ff(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', ...args], { windowsHide: true, timeout: 30000 })
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'viralcut-v4-test-'))
  source = join(dir, 'tones.mp4')
  silent = join(dir, 'silent.mp4')
  ff(['-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30',
    '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*440*t)*(between(t,0,2)+between(t,4,6))':s=48000",
    '-vf', "drawbox=color=red:t=fill:enable='between(t,4,6)'",
    '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source])
  ff(['-f', 'lavfi', '-i', 'color=s=320x180:r=30', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
    '-t', '3', '-c:v', 'libx264', '-c:a', 'aac', silent])
})
after(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

async function scan(input, opts = {}) {
  return analyzeSilence({ input, format: 'mp4', analysis: settings, signal, onProgress() {}, ...opts })
}
function save(input, name, edit, overlay) {
  return encodeClip({ input, output: join(dir, name), format: 'mp4', start: 0, end: 6, directory: dir,
    signal, onProgress() {}, overlay, edit: validateEdit(edit) })
}

test('FFmpeg detects all-silent audio and the pause between audible regions', async () => {
  const all = await scan(silent)
  assert.equal(all.silences.length, 1)
  assert.ok(all.silences[0].start < .035 && all.silences[0].end > 2.95)
  const { silences } = await scan(source)
  assert.equal(silences.length, 1)
  assert.ok(Math.abs(silences[0].start - 2) < .05)
  assert.ok(Math.abs(silences[0].end - 4) < .05)
})

test('selected silence is removed, protective gaps stay and joined audio matches video', async t => {
  const edit = { remove: [{ start: 2.2, end: 3.8 }], encoder: 'cpu' }
  await save(source, 'joined.mp4', edit)
  const output = join(dir, 'joined.mp4')
  const info = await probe(output, 'mp4', signal)
  assert.ok(Math.abs(Number(info.format.duration) - 4.4) < .07)
  const video = ff(['-i', output, '-an', '-vf', 'fps=30,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
  let red = -1
  for (let i = 0; i < video.length; i += 3) if (video[i] > 180 && video[i + 2] < 40) { red = i / 90; break }
  const audio = ff(['-i', output, '-vn', '-ar', '48000', '-ac', '1', '-f', 's16le', '-'])
  let audible = -1
  for (let i = 2.25 * 96000; i < audio.length; i += 2) {
    if (Math.abs(audio.readInt16LE(i)) > 7000) { audible = i / 96000; break }
  }
  assert.ok(Math.abs(red - 2.4) < .065 && Math.abs(audible - 2.4) < .065, JSON.stringify({ red, audible }))
  assert.ok(Math.abs(red - audible) < .05)
  t.diagnostic(JSON.stringify({ duration: info.format.duration, videoMarker: red, audioMarker: audible }))
})

test('vertical, square and landscape MP4 render at full target dimensions; Turkish ASS follows the frame', async t => {
  const overlay = { cues: [{ start: 0.2, end: 5, text: 'Türkçe altyazı' }],
    appearance: { style: 'classic', font: 'arial', position: 'bottom', size: 52, textColor: '#ffffff',
      highlightColor: '#b7fa70', backgroundColor: '#151515', highlight: false } }
  for (const [mode, width, height] of [['vertical',1080,1920],['square',1080,1080],['landscape',1920,1080]]) {
    const name = mode + '.mp4'
    const result = await save(source, name, { frame: { mode, zoom: 1.25, x: -.4, y: .2 }, encoder: 'auto' }, overlay)
    const output = join(dir, name)
    const info = await probe(output, 'mp4', signal)
    assert.deepEqual(info.streams.filter(s => s.codec_type === 'video').map(s => [s.width,s.height]), [[width,height]])
    const pixels = ff(['-ss','1','-i',output,'-vf','crop=600:140:'+(width-600)/2+':'+(height-140),'-frames:v','1',
      '-pix_fmt','gray','-f','rawvideo','-'])
    assert.ok(pixels.some(byte => byte > 200))
    t.diagnostic(mode + ' · ' + result.encoder)
  }
})

test('bad silence source and cancelled scan release; selections can be retried', async () => {
  await assert.rejects(scan(join(dir, 'missing.mp4')), /badSource/)
  await assert.rejects(scan(source, { signal: AbortSignal.abort() }), { name: 'AbortError' })
  assert.throws(() => validateEdit({ frame: { mode: 'vertical', zoom: 'raw', x: 0, y: 0 } }), /badEdit/)
  assert.ok((await scan(source)).silences.length === 1)
})

test('Shorts UI shows real silence, previews its removal, and exports a selected recommendation', { timeout: 70000 }, async () => {
  const server = await preview({ preview: { port: 0, open: false } })
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1360, height: 930 } })
    await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }) })
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port)
    const upload = page.locator('input[type=file]')
    await upload.setInputFiles(source)
    await page.locator('.silence-track').waitFor()
    const silence = page.locator('.silence-list input[type=checkbox]')
    await silence.check()
    const afterPreview = page.getByRole('button', { name: 'Düzenlenmiş önizleme', exact: true })
    await afterPreview.click()
    const playhead = page.getByRole('slider', { name: 'Oynatma konumu' })
    await playhead.focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.getByRole('button', { name: 'Oynat', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('video').currentTime > 3.7, null, { timeout: 5000 })
    await page.getByRole('button', { name: 'Duraklat', exact: true }).click()

    const long = join(dir, 'long.mp4')
    ff(['-stream_loop','4','-i',source,'-c','copy',long])
    await upload.setInputFiles(long)
    await page.locator('.silence-track').waitFor()
    const add = page.getByRole('button',{ name: /altyazı ekle/i })
    for (let i = 0; i < 6; i++) {
      await page.getByRole('slider', { name: 'Oynatma konumu' }).fill(String(i * 3))
      await add.click()
      await page.getByRole('textbox', { name: 'Altyazı metni ' + (i + 1), exact: true }).fill('Test cümlesi ' + (i + 1) + '.')
    }
    await page.getByRole('combobox', { name: 'Hedef süre' }).selectOption('15')
    await page.getByRole('button', { name: 'Klip aralığını seç' }).first().click()
    await page.getByRole('combobox', { name: 'Çıktı oranı' }).selectOption('vertical')
    await afterPreview.click()
    await page.locator('.video-frame.framed').waitFor()
    await page.getByRole('button', { name: 'Klibi hazırla' }).click()
    const save = page.getByRole('button', { name: 'MP4 olarak kaydet' })
    await save.waitFor({ timeout: 45000 })
    const downloading = page.waitForEvent('download')
    await save.click()
    const path = join(dir, 'candidate.mp4')
    await (await downloading).saveAs(path)
    const info = await probe(path, 'mp4', signal)
    const track = info.streams.find(s => s.codec_type === 'video')
    assert.deepEqual([track.width, track.height], [1080,1920])
    assert.ok(Number(info.format.duration) >= 10 && Number(info.format.duration) <= 20)
  } finally {
    await browser.close()
    await new Promise(resolve => server.httpServer.close(resolve))
  }
})
