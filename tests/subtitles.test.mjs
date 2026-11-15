import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { buildAss, validateOverlay } from '../server/ass.mjs'
import { parseCues, whisperAvailability } from '../server/whisper.mjs'

let browser, server, directory, address, silent
const liveWhisper = process.env.VIRALCUT_SPEECH_TEST === '1'

function ffmpeg(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, timeout: 45000 })
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'viralcut-caption-test-'))
  silent = join(directory, 'silent.mp4')
  ffmpeg(['-f', 'lavfi', '-i', 'color=black:s=640x360:r=24', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent])
  server = await preview({ preview: { port: 0, open: false } })
  address = 'http://127.0.0.1:' + server.httpServer.address().port
  browser = await chromium.launch({ channel: 'msedge' })
})

after(async () => {
  await browser?.close()
  if (server) await new Promise(resolve => server.httpServer.close(resolve))
  if (directory) await rm(directory, { recursive: true, force: true })
})

const appearance = {
  font: 'arial', style: 'box', position: 'top', size: 80,
  textColor: '#ffffff', highlightColor: '#00ff00', backgroundColor: '#000000', highlight: true,
}

test('ASS rebases selected ranges and validates formatting and word timing', () => {
  const cue = { start: 2, end: 5, text: 'Merhaba dünya',
    words: [{ start: 2.25, end: 3, text: 'Merhaba' }, { start: 4, end: 4.75, text: ' dünya' }] }
  const overlay = validateOverlay({ cues: [cue], appearance })
  const script = buildAss(overlay, 3.5, 5)
  assert.match(script, /Dialogue: 0,0:00:00\.50,0:00:01\.25.*Merhaba.*00FF00|Dialogue: 0,0:00:00\.50,0:00:01\.25.*Merhaba.*00ff00/)
  assert.doesNotMatch(script, /0:00:04/)
  assert.throws(() => validateOverlay({ cues: [{ ...cue, text: 'Changed' }], appearance }), /badSubtitles/)
  assert.throws(() => validateOverlay({ cues: [cue], appearance: { ...appearance, font: 'Arial,100' } }), /badSubtitles/)
  const offset = (from, to) => ({ offsets: { from, to } })
  const [usable, missing] = parseCues({ transcription: [
    { ...offset(0, 1500), text: ' Hello world', tokens: [
      { ...offset(50, 450), text: ' Hello' }, { ...offset(500, 950), text: ' world' },
    ] },
    { ...offset(1700, 2100), text: ' Late', tokens: [{ ...offset(1800, 1800), text: ' Late' }] },
  ] }, 300, 2)
  assert.equal(usable.words[0].start, 300.05)
  assert.equal(missing.end, 302)
  assert.equal(missing.words, undefined)
})

async function getDownload(page, button, name) {
  const downloading = page.waitForEvent('download')
  await button.click()
  const file = await downloading
  const path = join(directory, name)
  await file.saveAs(path)
  return path
}

test('subtitle editor, timeline, SRT/VTT, and visibly burned MP4', { timeout: 60000 }, async () => {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 920 } })
  try {
    await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }) })
    await page.goto(address)
    await page.locator('input[type=file]').setInputFiles(silent)
    await page.getByText('640 × 360', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Altyazı ekle' }).click()
    await page.getByRole('textbox', { name: 'Altyazı metni 1' }).fill('Türkçe ve English')
    const cueEnd = page.getByRole('textbox', { name: 'Bitiş 1', exact: true })
    await cueEnd.fill('3.5')
    await cueEnd.press('Enter')
    const cueStart = page.getByRole('textbox', { name: 'Başlangıç 1', exact: true })
    await cueStart.fill('1')
    await cueStart.press('Enter')
    const track = page.locator('.caption-track')
    await track.getByRole('button', { name: /Türkçe ve English/ }).click()
    await page.locator('.actual-caption').getByText('Türkçe ve English').waitFor()
    await page.getByLabel('Stil', { exact: true }).selectOption('box')
    await page.getByLabel('Konum', { exact: true }).selectOption('top')
    const srt = await getDownload(page, page.getByRole('button', { name: 'SRT' }), 'result.srt')
    const vtt = await getDownload(page, page.getByRole('button', { name: 'VTT' }), 'result.vtt')
    assert.equal(await readFile(srt, 'utf8'), '1\n00:00:01,000 --> 00:00:03,500\nTürkçe ve English\n')
    assert.equal(await readFile(vtt, 'utf8'), 'WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nTürkçe ve English\n')
    const start = page.getByRole('textbox', { name: 'Başlangıç (sn)' })
    await start.fill('2')
    await start.press('Enter')
    await page.getByRole('button', { name: 'Klibi hazırla' }).click()
    const output = await getDownload(page, page.getByRole('button', { name: 'MP4 olarak kaydet' }), 'rendered.mp4')
    function bright(at) {
      const frame = ffmpeg(['-ss', String(at), '-i', output, '-frames:v', '1', '-vf', 'crop=640:100:0:0', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
      return frame.reduce((count, byte) => count + (byte > 120), 0)
    }
    assert.ok(bright(0.5) > 80, 'Subtitles should be visible in the first 1.5 seconds of the trimmed clip')
    assert.equal(bright(2), 0)
    await page.locator('input[type=file]').setInputFiles(output)
    await page.getByText('640 × 360', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Oynat', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('video').currentTime > .3)
  } finally {
    await page.close()
  }
})

function words(text) {
  return text.toLocaleLowerCase('tr').match(/[\p{L}\p{N}]+/gu) ?? []
}

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j-1] + 1, row[j] + 1, row[j-1] + Number(a[i-1] !== b[j-1]))
    row = next
  }
  return row.at(-1)
}

function synthesize(language, text) {
  const wav = join(directory, language + '.wav')
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Speech; $voice=New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
    "$voice.SelectVoice($env:VIRALCUT_TEST_VOICE); $voice.SetOutputToWaveFile($env:VIRALCUT_TEST_WAV); " +
    "$voice.Speak($env:VIRALCUT_TEST_TEXT); $voice.Dispose()"
  execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, env: { ...process.env, VIRALCUT_TEST_VOICE: language === 'tr' ? 'Microsoft Tolga' : 'Microsoft Zira Desktop',
      VIRALCUT_TEST_WAV: wav, VIRALCUT_TEST_TEXT: text },
  })
  const video = join(directory, language + '.mp4')
  ffmpeg(['-f', 'lavfi', '-i', 'color=black:s=640x360:r=24', '-i', wav,
    '-af', 'adelay=1000', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', video])
  const pcm = ffmpeg(['-i', video, '-vn', '-ar', '16000', '-ac', '1', '-f', 's16le', '-'])
  let onset = 0
  for (let i = 0; i < pcm.length - 640; i += 640) {
    let squared = 0
    for (let j = i; j < i + 640; j += 2) squared += pcm.readInt16LE(j) ** 2
    if (Math.sqrt(squared / 320) > 180) { onset = i / 32000; break }
  }
  return { video, onset }
}

test('real Whisper recognition, language detection, timing, and cancellation', { skip: !liveWhisper, timeout: 120000 }, async t => {
  assert.ok((await whisperAvailability()).available, 'Install the model only with approval before running this test')
  const page = await browser.newPage()
  try {
    await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }) })
    await page.goto(address.replace('127.0.0.1', 'localhost'))
    const button = page.getByRole('button', { name: 'Altyazı oluştur' })
    const input = page.locator('input[type=file]')
    for (const [language, reference] of [
      ['tr','Merhaba. Bugün yerel video düzenleyicimizin altyazı özelliğini test ediyoruz. Ses ve görüntü bu bilgisayarda kalır.'],
      ['en','Hello. Today we are testing automatic subtitles on this computer. The video and audio stay on this device.'],
    ]) {
      const { video, onset } = synthesize(language, reference)
      await input.setInputFiles(video)
      if (language === 'en') {
        await page.getByLabel('Konuşma dili').selectOption('en')
        await page.getByLabel('İşlemci').selectOption('cpu')
      }
      const transcript = page.waitForResponse(response => response.url().endsWith('/transcript') && response.ok())
      const started = performance.now()
      await button.click()
      const result = await (await transcript).json()
      const milliseconds = Math.round(performance.now() - started)
      assert.deepEqual(result.languages, [language])
      if (language === 'en') assert.equal(result.backend, 'CPU')
      const recognized = result.cues.map(cue => cue.text).join(' ')
      const expected = words(reference)
      const edits = distance(expected, words(recognized))
      const firstTimedWord = result.cues.flatMap(cue => cue.words ?? [])[0]
      assert.ok(result.cues.length > 0 && firstTimedWord)
      assert.ok(edits / expected.length <= .25, recognized)
      const firstCue = result.cues[0]
      const firstCueTimingError = Math.abs(firstCue.start - onset)
      assert.ok(firstCueTimingError < .7, JSON.stringify({ onset, firstCue }))
      const firstWordTimingError = firstCue.words?.length ? Math.abs(firstCue.words[0].start - onset) : null
      if (firstWordTimingError !== null) assert.ok(firstWordTimingError < .7)
      t.diagnostic(JSON.stringify({ language, backend: result.backend, milliseconds, edits, referenceWords: expected.length,
        timedCues: result.cues.filter(cue => cue.words?.length).length, cues: result.cues.length,
        firstCueTimingErrorSeconds: Number(firstCueTimingError.toFixed(3)),
        firstWordTimingErrorSeconds: firstWordTimingError === null ? null : Number(firstWordTimingError.toFixed(3)), recognized }))
      await page.getByRole('textbox', { name: 'Altyazı metni 1' }).waitFor()
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Altyazı oluştur' && !button.disabled))
      if (language === 'tr') {
        await page.getByRole('button', { name: 'Klibi hazırla' }).click()
        const file = await getDownload(page, page.getByRole('button', { name: 'MP4 olarak kaydet' }), 'whisper-tr.mp4')
        const pixels = ffmpeg(['-ss', '1.4', '-i', file, '-frames:v', '1', '-vf', 'crop=640:100:0:260', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
        assert.ok(pixels.some(byte => byte > 180), 'Recognized Turkish text must be burned into the MP4')
        const audio = ffmpeg(['-i', file, '-vn', '-ar', '16000', '-ac', '1', '-f', 's16le', '-'])
        assert.ok(audio.length > 32000)
        assert.ok(audio.some(byte => byte !== 0), 'Export must retain audible speech')
        await input.setInputFiles(file)
        await page.getByRole('button', { name: 'Oynat', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('video').currentTime > 0.5)
        await page.getByRole('button', { name: 'Duraklat' }).click()
      }
    }

    await input.setInputFiles(silent)
    await button.click()
    await page.getByRole('alert').getByText(/ses parçası yok/).waitFor()
    const longSpeech = join(directory, 'long-speech.mp4')
    ffmpeg(['-stream_loop', '28', '-i', join(directory, 'en.mp4'), '-c', 'copy', longSpeech])
    await input.setInputFiles(longSpeech)
    await page.getByLabel('İşlemci').selectOption('cpu')
    await button.click()
    await page.getByText('Konuşma algılanıyor…', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'İptal et' }).click()
    await page.getByText('Altyazı oluşturma iptal edildi.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Altyazı metni 1' }).count(), 0)
    assert.equal((await readdir(tmpdir())).some(file => file.startsWith('viralcut-export-v3-' + process.pid + '-')), false)
    await input.setInputFiles(silent)
    await page.getByRole('button', { name: 'Klibi hazırla' }).click()
    await page.getByText(/Klip hazır/).waitFor()
  } finally {
    await page.close()
  }
})
