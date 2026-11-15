import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { createCalendar, prepareCreator } from '../desktop/creator.mjs'
import { createYouTube, uploadMetadata, youtubeError } from '../desktop/youtube.mjs'
import { creatorMetadata, creatorProfile, validatePlatformMedia } from '../server/creator.mjs'
import { parseCopilot } from '../src/editor/copilotPlan.ts'
import { suggestMetadata, creatorStyles } from '../src/editor/creatorMetadata.ts'
import { probe, run } from '../server/media.mjs'
import { startShortsBatch } from '../server/shorts-batch.mjs'

const ids = ['youtube', 'tiktok', 'instagram']
const sample = { title: 'Yerel düzenleme', description: 'Bu videoda kurgu var.', hashtags: ['#kurgu'], keywords: ['kurgu'] }
const cues = [{ start: 1, end: 4, text: 'Yerel video düzenleme ve kaynak doğrulama.' },
  { start: 6, end: 9, text: 'Bir sonraki aşamada kaynak videoyu kesiyoruz.' },
  { start: 41, end: 44, text: 'Klip dışı içerik — saklı olay.' }]
const range = { start: 0, end: 16 }
const frame = { mode: 'vertical', x: 0, y: 0, zoom: 1 }

for (const id of ids) {
  test(id + ' export profile validates exact portrait H.264/AAC and timing', () => {
    const profile = creatorProfile(id, { fps: 25, bitrate: 5400, max: 60 })
    const video = { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, avg_frame_rate: '25/1' }
    const audio = { codec_type: 'audio', codec_name: 'aac' }
    assert.equal(validatePlatformMedia({ format: { duration: 16 }, streams: [video, audio] }, 1000, profile, true), true)
    assert.equal(validatePlatformMedia({ format: { duration: 61 }, streams: [video, audio] }, 1000, profile, true), false)
    assert.equal(validatePlatformMedia({ format: { duration: 20 }, streams: [video] }, 1000, profile, true), false)
    assert.equal(validatePlatformMedia({ format: { duration: 20 }, streams: [video] }, profile.bytes + 1, profile, false), false)
  })
  test(id + ' metadata validates title, caption and proper hashtags', () => {
    assert.equal(creatorMetadata(id, sample).caption, 'Bu videoda kurgu var.\n\n#kurgu')
    assert.throws(() => creatorMetadata(id, { ...sample, title: '<h1>' }))
    assert.throws(() => creatorMetadata(id, { ...sample, hashtags: ['#broken link'] }))
    assert.throws(() => creatorMetadata(id, { ...sample, description: 'ğ'.repeat(5200) }))
  })
}
test('adjustable profiles reject invalid values and extra input fields', () => {
  for (const preset of [{ fps: 61 }, { bitrate: 20000 }, { max: 181 }, { codec: 'copy' }]) {
    assert.throws(() => creatorProfile('youtube', preset), /badEdit/)
  }
  assert.throws(() => creatorProfile('other'), /badEdit/)
})
test('portrait platform validation rejects landscape and invalid frame rates', () => {
  const profile = creatorProfile('instagram')
  const video = { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, avg_frame_rate: '30/1' }
  const validate = stream => validatePlatformMedia({ format: { duration: 16 }, streams: [stream] }, 1000, profile, false)
  assert.equal(validate(video), true)
  assert.equal(validate({ ...video, width: 1920, height: 1080 }), false)
  assert.equal(validate({ ...video, avg_frame_rate: '0/0' }), false)
})
test('YouTube description limits include Unicode byte length and hashtags', () => {
  const input = { ...sample, description: 'ğ'.repeat(2500), hashtags: [] }
  assert.equal(Buffer.byteLength(creatorMetadata('youtube', input).caption), 5000)
  assert.throws(() => creatorMetadata('youtube', { ...input, hashtags: ['#ek'] }), /badMetadata/)
})
for (const style of creatorStyles) {
  test(style + ' presents five scoped Turkish and English titles without outside claims', () => {
    const tr = suggestMetadata(cues, range, ['dog'], 'tr', style)
    assert.equal(tr.titles.length, 5)
    assert.ok(tr.keywords.length && tr.hashtags.length && tr.short)
    assert.ok(!JSON.stringify(tr).includes('saklı olay'))
    const en = suggestMetadata([{ start: 1, end: 4, text: 'Editing a local video source.' }], range, [], 'en', style)
    assert.equal(en.titles.length, 5)
    assert.match(en.description, /Editing/)
  })
}
test('silent clip descriptions label observations and avoid asserting events', () => {
  const result = suggestMetadata([], range, ['person', 'car'], 'tr', 'professional')
  assert.equal(result.evidence, 'vision')
  assert.equal(result.titles.length, 5)
  assert.match(result.description, /Görsel model etiketleri/)
  assert.equal(suggestMetadata([], range, [], 'en', 'minimal').evidence, 'range')
})
test('Creator Copilot plans cover, titles, packages, targeted clips and calendar', () => {
  assert.deepEqual(parseCopilot('Bu videodan 5 YouTube Shorts hazırla.').steps, [{ tool: 'creator', action: 'shorts', platform: 'youtube', count: 5 }])
  for (const [input, kind] of [['TikTok için daha kısa bir versiyon oluştur.', 'shorts'], ['Instagram için kapak görseli oluştur.', 'cover'],
    ['Bu videoya 5 dikkat çekici başlık yaz.', 'titles'], ['Videolarımı gelecek hafta için yayın takvimine ekle.', 'calendar'],
    ['Bu üç platforma uygun videoları hazırla.', 'packages']]) assert.equal(parseCopilot(input).steps?.[0].action, kind)
  assert.equal(parseCopilot('Upload to TikTok').error, 'unsafe')
})
test('calendar survives reopening and changes copy without background publishing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'viralcut-creator-calendar-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = createCalendar(root)
  const planned = await first.save({ ...sample, platform: 'youtube', plannedAt: '2028-05-01T12:00:00.000Z' }, 'youtube-00000000.mp4')
  const reopened = createCalendar(root)
  assert.equal((await reopened.list())[0].status, 'planned')
  assert.equal((await reopened.save({ ...planned, title: 'Yeni başlık', plannedAt: '' })).status, 'ready')
  assert.equal((await reopened.list())[0].title, 'Yeni başlık')
  await assert.rejects(reopened.save({ ...sample, platform: 'tiktok', plannedAt: '2028-02-30T00:00:00.000Z' }))
})
test('YouTube metadata enforces explicit child audience and a future private schedule', () => {
  const valid = { ...sample, privacy: 'private', forKids: false, synthetic: false, publishAt: '2030-01-02T11:00:00.000Z' }
  assert.equal(uploadMetadata(valid, 'CHANNEL1234', Date.parse('2030-01-01')).status.publishAt, valid.publishAt)
  assert.throws(() => uploadMetadata({ ...valid, privacy: 'public' }, 'CHANNEL1234', Date.parse('2030-01-01')))
  assert.throws(() => uploadMetadata(valid, 'CHANNEL1234', Date.parse('2030-02-01')))
  assert.throws(() => uploadMetadata({ ...valid, forKids: undefined }, 'CHANNEL1234', 0))
})
test('YouTube distinguishes quota, permission and rejection', () => {
  assert.equal(youtubeError(403, 'quotaExceeded'), 'youtubeQuota')
  assert.equal(youtubeError(429), 'youtubeQuota')
  assert.equal(youtubeError(403, 'forbidden'), 'youtubePermission')
  assert.equal(youtubeError(400), 'youtubeRejected')
})
test('YouTube without a connected account never contacts the network', async t => {
  const root = await mkdtemp(join(tmpdir(), 'viralcut-youtube-offline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const youtube = createYouTube({ folder: root, storage: { isEncryptionAvailable: () => true },
    request: () => assert.fail('Unexpected network request') })
  assert.equal(await youtube.account(), undefined)
  await assert.rejects(youtube.start('x.mp4', { channel: 'CHANNEL1234' }, () => assert.fail('Unexpected confirmation')), /youtubePermission/)
  await youtube.close()
})
for (const [label, error, request] of [
  ['quota rejection', 'youtubeQuota', () => Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 })],
  ['offline failure', 'youtubeNetwork', () => { throw TypeError('fetch failed') }],
]) {
  test('mock YouTube ' + label + ' leaves the local media intact', async t => {
    const root = await mkdtemp(join(tmpdir(), 'viralcut-youtube-failed-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'source.mp4')
    await writeFile(path, 'preserved')
    await writeFile(join(root, 'youtube.secure'), JSON.stringify({ channel: { id: 'CHANNEL1234' }, client: {}, refresh: 'fixture' }))
    const youtube = createYouTube({ folder: root, storage: { isEncryptionAvailable: () => true, decryptString: bytes => bytes.toString() }, request })
    const raw = { ...sample, channel: 'CHANNEL1234', privacy: 'private', forKids: false, synthetic: false }
    assert.equal((await youtube.start(path, raw, () => true)).started, true)
    for (let i = 0; i < 100 && youtube.status().phase === 'uploading'; i++) await setTimeout(10)
    assert.equal(youtube.status().phase, 'failed')
    assert.equal(youtube.status().error, error)
    assert.equal(await readFile(path, 'utf8'), 'preserved')
    await youtube.close()
  })
}
test('mock YouTube consent gate performs no request; upload acknowledgement must be verified separately', async t => {
  const root = await mkdtemp(join(tmpdir(), 'viralcut-youtube-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const data = { channel: { id: 'CHANNEL1234', name: 'Test' }, client: {}, refresh: 'fixture' }
  await writeFile(join(root, 'youtube.secure'), JSON.stringify(data))
  const path = join(root, 'fixture.mp4')
  await writeFile(path, Buffer.alloc(50))
  let calls = 0
  const youtube = createYouTube({ folder: root, storage: { isEncryptionAvailable: () => true, decryptString: data => data.toString() },
    request: async (url, options) => {
      calls++
      if (String(url).includes('oauth2.googleapis')) return Response.json({ access_token: 'local-fixture' })
      if (String(url).includes('uploadType')) return new Response(null, { headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test' } })
      if (options.method === 'PUT') return Response.json({ id: 'abc123xyz98' })
      return Response.json({ items: [{ id: 'abc123xyz98', snippet: { channelId: 'CHANNEL1234' }, status: { privacyStatus: 'private', uploadStatus: 'processed' } }] })
    } })
  const raw = { ...sample, channel: data.channel.id, privacy: 'private', forKids: false, synthetic: false }
  assert.deepEqual(await youtube.start(path, raw, () => false), { cancelled: true })
  assert.equal(calls, 0)
  assert.equal((await youtube.start(path, raw, () => true)).started, true)
  for (let i = 0; i < 100 && youtube.status().phase !== 'verified'; i++) await setTimeout(10)
  assert.equal(youtube.status().phase, 'verified')
  assert.equal(youtube.status().visibility, 'private')
  assert.equal(calls, 4)
  await youtube.close()
})
test('FFmpeg creates three distinct 1080×1920 packages with sidecars and JPEG covers', { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'viralcut-creator-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const signal = AbortSignal.timeout(115000)
  const path = join(root, 'source.mp4')
  const out = join(root, 'out')
  await mkdir(out)
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=16',
    '-f', 'lavfi', '-i', 'sine=duration=16', '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', path], signal)
  const { stat } = await import('node:fs/promises')
  const source = { path, format: 'mp4', size: (await stat(path)).size }
  const raw = { mediaId: 'fixture', items: ids.map(platform => ({ ...range, frame, remove: [], platform, metadata: sample })) }
  const invalid = { ...raw, items: [{ ...raw.items[0], frame: { ...frame, mode: 'landscape' } }] }
  const projects = { resolveMedia: () => source }
  await assert.rejects(prepareCreator(invalid, out, projects), /badRange/)
  const planned = await prepareCreator(raw, out, projects)
  const batch = startShortsBatch(planned.job, source, planned.folder, dir => rm(dir, { recursive: true, force: true }), 'viralcut-test-creator-', undefined, true)
  await batch.work
  assert.equal((await readdir(planned.folder)).length, 9)
  for (const item of batch.snapshot().items) {
    assert.equal(item.phase, 'ready', JSON.stringify(item))
    const metadata = JSON.parse(await readFile(join(planned.folder, item.filename.replace('.mp4', '.json')), 'utf8'))
    assert.equal(metadata.metadata.title, sample.title)
    const info = await probe(join(planned.folder, item.filename), 'mp4', signal)
    assert.equal(info.streams[0].width, 1080)
    assert.equal(info.streams[0].height, 1920)
    const cover = await readFile(join(planned.folder, metadata.cover))
    assert.equal(cover.subarray(0, 3).toString('hex'), 'ffd8ff')
  }
})
