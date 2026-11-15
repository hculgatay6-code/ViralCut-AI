import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as pause } from 'node:timers/promises'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { preview } from 'vite'

const headers = { 'X-ViralCut': '2' }
let directory, server, address, short, long, webm

function ffmpeg(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  })
}

function makeMarkerVideo(name, duration, marker) {
  const file = join(directory, name)
  ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24',
    '-f', 'lavfi', '-i', "aevalsrc='0.55*sin(2*PI*1000*t)*between(t," + marker + ',' + (marker + 0.249) + ")':s=48000",
    '-vf', "drawbox=color=red:t=fill:enable='between(t," + marker + ',' + (marker + 0.249) + ")'",
    '-t', String(duration), '-g', '72', '-threads', '2', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', file,
  ])
  return file
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'viralcut-v2-test-'))
  short = makeMarkerVideo('short.mp4', 8, 2.5)
  long = makeMarkerVideo('hour.mp4', 3600, 3593.5)
  webm = join(directory, 'portrait.webm')
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=180x320:r=24', '-t', '3', '-c:v', 'libvpx-vp9', webm])
  server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } })
  address = 'http://127.0.0.1:' + server.httpServer.address().port
})

after(async () => {
  if (server) await new Promise(resolve => server.httpServer.close(resolve))
  if (directory) await rm(directory, { recursive: true, force: true })
})

async function api(path = '', options = {}) {
  return fetch(address + '/api/export' + path, { ...options, headers: { ...headers, ...options.headers } })
}

async function createJob(source, start, end, format = 'mp4') {
  const { size } = await stat(source)
  const response = await api('', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format, start, end, size }),
  })
  const data = await response.json()
  assert.equal(response.status, 201, JSON.stringify(data))
  return { ...data, size }
}

async function upload(job, file) {
  const response = await api('/' + job.id + '/input', {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(job.size) },
    body: createReadStream(file), duplex: 'half',
  })
  assert.equal(response.status, 202, await response.text())
}

async function waitForJob(job, phase) {
  let previous = 0
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await (await api('/' + job.id)).json()
    if (result.phase === phase) return result
    assert.notEqual(result.phase, 'failed', JSON.stringify(result))
    assert.ok(result.progress >= previous && result.progress <= 100)
    previous = result.progress
    await pause(125)
  }
  assert.fail('Job did not reach ' + phase)
}

async function release(job) {
  assert.equal((await api('/' + job.id, { method: 'DELETE' })).status, 200)
  assert.equal((await api('/' + job.id)).status, 404)
  assert.equal((await readdir(tmpdir())).some(name => name.startsWith('viralcut-export-v3-' + process.pid + '-')), false)
}

function mediaInfo(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]))
}

function verifyCut(file, duration, width, height, expectedMarker) {
  const result = mediaInfo(file)
  const video = result.streams.find(stream => stream.codec_type === 'video')
  const audio = result.streams.find(stream => stream.codec_type === 'audio')
  assert.deepEqual([video.codec_name, video.width, video.height], ['h264', width, height])
  assert.ok(Math.abs(Number(result.format.duration) - duration) <= 0.055, result.format.duration)
  ffmpeg(['-i', file, '-f', 'null', '-'])
  if (expectedMarker === undefined) {
    assert.equal(audio, undefined)
    return
  }
  assert.equal(audio.codec_name, 'aac')

  // Independently measure the first red frame and the first audible tone in the exported clip.
  const rgb = ffmpeg(['-i', file, '-an', '-vf', 'fps=24,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
  let firstRed = -1
  for (let index = 0; index < rgb.length; index += 3) {
    if (rgb[index] > 150 && rgb[index + 2] < 60) { firstRed = index / 3 / 24; break }
  }
  const pcm = ffmpeg(['-i', file, '-vn', '-ar', '48000', '-ac', '1', '-f', 's16le', '-'])
  let firstTone = -1
  for (let index = 0; index < pcm.length; index += 2) {
    if (Math.abs(pcm.readInt16LE(index)) > 4000) { firstTone = index / 2 / 48000; break }
  }
  assert.ok(firstRed >= 0 && Math.abs(firstRed - expectedMarker) <= 0.055, 'Video onset: ' + firstRed)
  assert.ok(firstTone >= 0 && Math.abs(firstTone - expectedMarker) <= 0.025, 'Audio onset: ' + firstTone)
  assert.ok(Math.abs(firstTone - firstRed) <= 0.06, 'A/V difference: ' + Math.abs(firstTone - firstRed))
  return { videoOnset: firstRed, audioOnset: firstTone }
}

test('MP4 export service with real FFmpeg', { timeout: 120000 }, async t => {
  assert.deepEqual(await (await api()).json(), { available: true })

  await t.test('non-keyframe cut near the end of a one-hour MP4 preserves dimensions and A/V timing', async () => {
    assert.equal(Number(mediaInfo(long).format.duration), 3600)
    const start = 3592.125
    const end = 3595.375
    const job = await createJob(long, start, end)
    try {
      await upload(job, long)
      assert.equal((await waitForJob(job, 'ready')).progress, 100)
      const response = await api('/' + job.id + '/file')
      assert.equal(response.status, 200)
      const output = join(directory, 'hour-cut.mp4')
      await pipeline(Readable.fromWeb(response.body), createWriteStream(output))
      t.diagnostic(JSON.stringify(verifyCut(output, end - start, 320, 180, 3593.5 - start)))
    } finally {
      await release(job)
    }
  })

  await t.test('corrupt source, out-of-bounds range, cancellation, and concurrent work', async () => {
    const broken = join(directory, 'broken.mp4')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(broken, 'not video')
    let job = await createJob(broken, 0, 1)
    await upload(job, broken)
    assert.equal((await waitForJob(job, 'failed')).error, 'badSource')
    await release(job)

    job = await createJob(short, 7, 9)
    await upload(job, short)
    assert.equal((await waitForJob(job, 'failed')).error, 'badRange')
    await release(job)

    job = await createJob(long, 0, 3599)
    await upload(job, long)
    const processing = await (await api('/' + job.id)).json()
    assert.equal(processing.phase, 'processing')
    assert.equal((await api('', { method: 'POST' })).status, 409)
    await release(job)
  })

  await t.test('loopback API requires same origin and the expected request header', async () => {
    const localhost = address.replace('127.0.0.1', 'localhost')
    const alias = await fetch(localhost + '/api/export', {
      headers: { ...headers, Origin: localhost, 'Sec-Fetch-Site': 'same-origin' },
    })
    assert.equal(alias.status, 200)
    assert.deepEqual(await alias.json(), { available: true })
    assert.equal((await fetch(localhost + '/api/export', { headers: { ...headers, Origin: address } })).status, 403)
    assert.equal((await fetch(address + '/api/export')).status, 403)
    assert.equal((await api('', { headers: { Origin: 'https://example.invalid' } })).status, 403)
    assert.equal((await api('', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
    const wrongHost = await new Promise((resolve, reject) => {
      get(address + '/api/export', { headers: { ...headers, Host: 'localhost.invalid' } }, response => {
        response.resume()
        resolve(response.statusCode)
      }).on('error', reject)
    })
    assert.equal(wrongHost, 403)
  })
})

test('Edge export UI saves and reopens a short MP4 and exports portrait WebM', { timeout: 90000 }, async t => {
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    const page = await browser.newPage({ acceptDownloads: true })
    const pageErrors = []
    const remoteRequests = []
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith(address + '/')) remoteRequests.push(request.url())
    })
    // Exercise the actual download fallback with a real browser download.
    await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }))
    await page.goto(address)
    await page.locator('input[type=file]').setInputFiles(short)
    await page.getByText('320 × 180', { exact: true }).waitFor()
    const start = page.getByRole('textbox', { name: 'Başlangıç (sn)' })
    const end = page.getByRole('textbox', { name: 'Bitiş (sn)' })
    await start.fill('1.375')
    await start.press('Enter')
    await end.fill('4.625')
    await end.press('Enter')
    const name = page.getByRole('textbox', { name: 'Dosya adı' })
    await name.fill('CON')
    await page.getByRole('button', { name: 'Klibi hazırla' }).click()
    await page.getByRole('alert').getByText(/geçerli bir dosya adı/).waitFor()
    await name.fill('ViralCut kısa test')
    await page.getByRole('button', { name: 'Klibi hazırla' }).click()
    await page.getByText(/Klip hazır/).waitFor()
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'MP4 olarak kaydet' }).click()
    const download = await downloading
    assert.equal(download.suggestedFilename(), 'ViralCut kısa test.mp4')
    const saved = join(directory, download.suggestedFilename())
    await download.saveAs(saved)
    t.diagnostic(JSON.stringify(verifyCut(saved, 3.25, 320, 180, 1.125)))
    await page.locator('input[type=file]').setInputFiles(saved)
    await page.getByText('320 × 180', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Oynat', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('video').currentTime > 0.25)
    await page.getByRole('button', { name: 'Duraklat' }).click()

    // Stand in for the Windows picker while exercising streamed writes, cancel, and retry.
    const portrait = join(directory, 'portrait-output.mp4')
    const { appendFile, writeFile } = await import('node:fs/promises')
    await writeFile(portrait, '')
    await page.exposeFunction('writeExportChunk', async bytes => appendFile(portrait, Buffer.from(bytes)))
    await page.evaluate(() => {
      let tries = 0
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => {
        if (++tries === 1) throw new DOMException('Cancelled', 'AbortError')
        if (tries === 2) return { name: 'readonly.mp4', createWritable: () => { throw new Error('Device error') } }
        return {
          name: 'portrait-output.mp4',
          createWritable: async () => new WritableStream({ write: bytes => window.writeExportChunk(Array.from(bytes)) }),
        }
      } })
    })
    await page.locator('input[type=file]').setInputFiles(webm)
    await page.getByText('180 × 320', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Klibi hazırla' }).click()
    const save = page.getByRole('button', { name: 'MP4 olarak kaydet' })
    await save.click()
    await save.click()
    await page.getByRole('alert').getByText(/Dosya kaydedilemedi/).waitFor()
    await save.click()
    await page.getByText('Kaydedildi portrait-output.mp4', { exact: true }).waitFor()
    verifyCut(portrait, 3, 180, 320)
    assert.ok((await readFile(portrait)).length > 0)
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(remoteRequests, [])

    await page.locator('input[type=file]').setInputFiles(long)
    await page.getByText('01:00:00.000', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: 'Klibi hazırla' }).click()
    await page.getByRole('button', { name: 'İptal et' }).click()
    await page.getByText('Dışa aktarma iptal edildi.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'İptal et' }).waitFor({ state: 'hidden' })
    assert.equal((await readdir(tmpdir())).some(file => file.startsWith('viralcut-export-v3-' + process.pid + '-')), false)
  } finally {
    await browser.close()
  }
})
