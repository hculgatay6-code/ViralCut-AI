import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell } from 'electron'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createExportService } from '../server/export.mjs'
import { checkTools } from '../server/media.mjs'
import { modelVerified, whisperAvailability } from '../server/whisper.mjs'
import { createProjectStore, localPath } from './projects.mjs'
import { batchSize } from '../server/shorts-batch.mjs'
import { ExportError } from '../server/media.mjs'
import { createPreviewQueue } from '../server/preview.mjs'
import { validateOverlay } from '../server/ass.mjs'
import { createDiagnostics } from './diagnostics.mjs'
import { prepareDirector } from './director.mjs'
import { createAnalysisCache } from '../server/analysis-cache.mjs'
import { createResourceBudget, profileNames } from '../server/resource-budget.mjs'
import { createPerformanceMonitor } from './performance.mjs'
import { createCalendar, prepareCreator } from './creator.mjs'
import { creatorProfile } from '../server/creator.mjs'
import { createYouTube } from './youtube.mjs'
import { betaSettings, checkGitHubRelease, saveDiagnosticReport, startSessionMarker } from './beta.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const resources = app.isPackaged ? process.resourcesPath : join(root, 'desktop-resources')
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
}
const secret = randomBytes(32).toString('hex')
const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const previousProfile = join(app.getPath('appData'), 'ViralCut AI Desktop')
let win, web, service, origin
let directorPreview
let creatorOutput, calendar, youtube
let projects, previews, diagnostics
let cache, budget, performanceMonitor
let settings, markClean
let quitting = false
let choosingModel = false
let saving = false
let closeRequested = false
let closeTimer
let microphoneUntil = 0

function trusted(event) {
  const frame = event.senderFrame
  return win && !quitting && event.sender === win.webContents &&
    frame === win.webContents.mainFrame && frame.url === origin + '/'
}

function safeFilename(name) {
  // oxlint-disable-next-line no-control-regex -- Windows filenames cannot contain control characters.
  const invalidCharacters = /[<>:"/\\|?*\x00-\x1f]/
  return typeof name === 'string' && name.length <= 154 && /^.+\.mp4$/i.test(name) &&
    !invalidCharacters.test(name) && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
}

function configureTools() {
  process.env.VIRALCUT_FFMPEG = join(resources, 'ffmpeg', 'ffmpeg.exe')
  process.env.VIRALCUT_FFPROBE = join(resources, 'ffmpeg', 'ffprobe.exe')
  process.env.VIRALCUT_WHISPER_CPU = join(resources, 'whisper')
  delete process.env.VIRALCUT_MODEL
}

async function configureModel() {
  for (const profile of [app.getPath('userData'), previousProfile]) {
    try {
      const settings = JSON.parse(await readFile(join(profile, 'model.json'), 'utf8'))
      if (typeof settings.path === 'string' && await modelVerified(settings.path)) {
        process.env.VIRALCUT_MODEL = settings.path
        return
      }
    } catch { /* A fresh profile can use the model in LocalAppData. */ }
  }
  if (!await modelVerified()) process.env.VIRALCUT_MODEL = join(app.getPath('userData'), 'no-model-selected')
}

function registerDialogs() {
  const mediaFilter = [{ name: 'Video', extensions: ['mp4', 'webm'] }]
  const projectFilter = [{ name: 'ViralCut projesi', extensions: ['viralcut'] }]
  let projectDialog = false
  const safeHandle = (name, action, dialogAction = false) => ipcMain.handle('viralcut:' + name, async (event, argument) => {
    if (!trusted(event) || (dialogAction && projectDialog)) return { error: 'projectError' }
    if (dialogAction) projectDialog = true
    try {
      return await action(argument)
    } catch (error) {
      diagnostics.record(name, 'failed', undefined, error.code ?? error.message)
      return { error: error.message === 'badProject' ? 'badProject' : 'projectError' }
    } finally {
      if (dialogAction) projectDialog = false
    }
  })
  safeHandle('diagnostics-read', () => ({ entries: diagnostics.entries() }))
  safeHandle('diagnostics-export', async language => {
    const picked = await dialog.showSaveDialog(win, { defaultPath: join(app.getPath('documents'), 'ViralCut-Beta-Diagnostics.json'),
      title: language === 'en' ? 'Save diagnostic report' : 'Tanılama raporunu kaydet', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (picked.canceled) return { cancelled: true }
    if (!localPath(picked.filePath) || extname(picked.filePath).toLowerCase() !== '.json') return { error: 'badPath' }
    await saveDiagnosticReport(picked.filePath, app.getVersion(), diagnostics)
    return { saved: true }
  }, true)
  safeHandle('beta-settings-read', () => ({ settings: settings.read(), version: app.getVersion() }))
  safeHandle('beta-settings-save', async requested => ({ settings: await settings.save(requested) }))
  let updateCheck
  safeHandle('beta-update-check', () => {
    updateCheck ??= checkGitHubRelease(settings.read().repository, app.getVersion()).finally(() => { updateCheck = undefined })
    return updateCheck
  })
  safeHandle('beta-github-open', async target => {
    const { repository } = settings.read()
    if (!repository || !['repository', 'issues', 'releases'].includes(target)) return { error: 'unconfigured' }
    await shell.openExternal('https://github.com/' + repository + (target === 'repository' ? '' : '/' + target))
    return { opened: true }
  })
  let preparingCreator = false
  safeHandle('creator-profiles', () => ['youtube', 'tiktok', 'instagram'].map(id => ({ id, ...creatorProfile(id) })))
  safeHandle('creator-start', async request => {
    if (preparingCreator || service.batchStatus().active) return { error: 'busy' }
    if (!request || !['tr', 'en'].includes(request.language) || !idPattern.test(request.mediaId) ||
        Buffer.byteLength(JSON.stringify(request)) > 2 * 1024 * 1024) return { error: 'badEdit' }
    preparingCreator = true
    try {
      const picked = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'],
        title: request.language === 'tr' ? 'İçerik paketi klasörü' : 'Content package folder' })
      if (picked.canceled) return { cancelled: true }
      const { folder, job, profiles } = await prepareCreator(request, picked.filePaths[0], projects)
      const result = await service.startBatch(job, folder, true)
      creatorOutput = { folder, profiles, batch: result }
      return result
    } catch (error) { return { error: error instanceof ExportError ? error.message : 'saveFailed' } }
    finally { preparingCreator = false }
  }, true)
  function updateCreator() {
    if (!creatorOutput) return
    const latest = service.batchStatus()
    if (latest.id === creatorOutput.batch.id) creatorOutput.batch = latest
    return creatorOutput
  }
  safeHandle('creator-status', () => updateCreator()?.batch ?? { active: false, items: [] })
  safeHandle('creator-cancel', () => {
    if (creatorOutput?.batch.id === service.batchStatus().id) service.cancelBatch()
    return {}
  })
  safeHandle('creator-reveal', () => creatorOutput ? shell.openPath(creatorOutput.folder).then(error => ({ opened: !error })) : {})
  safeHandle('creator-calendar-list', async () => ({ rows: await calendar.list() }))
  safeHandle('creator-calendar-save', async raw => {
    if (!raw || Buffer.byteLength(JSON.stringify(raw)) > 16000) return { error: 'badMetadata' }
    const batch = updateCreator()?.batch
    const filename = batch?.items.find(item => item.platform === raw.platform && item.phase === 'ready' && item.filename === raw.output)?.filename
    if (raw.output && !filename) return { error: 'badMetadata' }
    try { return { row: await calendar.save(raw, filename) } } catch { return { error: 'badMetadata' } }
  })
  const youtubeReply = async action => {
    try { return await action() } catch (error) {
      return { error: /^(youtube\w+|busy|badMetadata)$/.test(error.message) ? error.message : 'youtubeNetwork' }
    }
  }
  safeHandle('creator-youtube-account', async () => ({ channel: await youtube.account() }))
  safeHandle('creator-youtube-connect', () => youtubeReply(async () => {
    const chosen = await dialog.showOpenDialog(win, { title: 'YouTube OAuth Desktop app JSON', properties: ['openFile'],
      filters: [{ name: 'OAuth JSON', extensions: ['json'] }] })
    if (chosen.canceled) return { cancelled: true }
    const selected = chosen.filePaths[0]
    if (!localPath(selected)) return { error: 'youtubeCredentials' }
    const path = await realpath(selected)
    if (!localPath(path) || extname(path).toLowerCase() !== '.json') return { error: 'youtubeCredentials' }
    return { channel: await youtube.connect(path) }
  }), true)
  safeHandle('creator-youtube-disconnect', () => youtubeReply(async () => { await youtube.disconnect(); return {} }), true)
  safeHandle('creator-youtube-start', raw => youtubeReply(async () => {
    if (!raw || Buffer.byteLength(JSON.stringify(raw)) > 16000) return { error: 'badMetadata' }
    const state = updateCreator()
    if (!state?.batch.items.some(item => item.platform === 'youtube' && item.phase === 'ready' && item.filename === raw.filename))
      return { error: 'badSource' }
    const video = join(state.folder, raw.filename)
    if (await realpath(video) !== video) return { error: 'badSource' }
    return youtube.start(video, raw, async (channel, metadata) => {
      const tr = raw.language === 'tr'
      const result = await dialog.showMessageBox(win, { type: 'question', noLink: true, defaultId: 0, cancelId: 0,
        buttons: tr ? ['Vazgeç', 'YouTube’a gönder'] : ['Cancel', 'Send to YouTube'],
        message: tr ? 'Bu video Google sunucularına gönderilsin mi?' : 'Send this video to Google servers?',
        detail: [channel.name + ' (' + channel.id + ')', raw.filename, metadata.snippet.title, metadata.snippet.description,
          metadata.status.privacyStatus, metadata.status.publishAt].filter(Boolean).join('\n\n') })
      return result.response === 1
    })
  }), true)
  safeHandle('creator-youtube-status', () => ({ upload: youtube.status() }))
  safeHandle('creator-youtube-cancel', () => { youtube.cancel(); return {} })
  safeHandle('copilot-microphone', allow => {
    microphoneUntil = allow === true ? Date.now() + 15000 : 0
    return { allowed: allow === true }
  })
  safeHandle('performance-read', async () => {
    const [system, analysisCache] = await Promise.all([performanceMonitor.sample(), cache.info()])
    return { system, analysisCache, budget: budget.info(), activity: service.activity(),
      recent: diagnostics.entries().filter(row => ['shorts-analysis', 'transcribe', 'export', 'sequence', 'batch'].includes(row.operation)).slice(0, 6) }
  })
  safeHandle('performance-profile', profile => {
    if (profileNames.includes(profile)) budget.change(profile)
    return {}
  })
  safeHandle('performance-clear', async () => ({ cleared: await service.clearCache() }))
  safeHandle('source-file', path => projects.register(path, true).then(media => ({ media })))
  safeHandle('close-confirmed', () => {
    if (closeRequested) { clearTimeout(closeTimer); app.quit() }
    return {}
  })
  const shelf = join(app.getPath('userData'), 'caption-templates.json')
  const exampleCue = { start: 0, end: 1, text: 'Example' }
  function template({ name, appearance } = {}) {
    // oxlint-disable-next-line no-control-regex -- Keep line breaks and control characters out of template names.
    if (typeof name !== 'string' || !name.trim() || name.length > 48 || /[\x00-\x1f]/.test(name)) throw new Error('badTemplate')
    const keys = ['font', 'position', 'style', 'size', 'textColor', 'backgroundColor', 'highlightColor', 'highlight',
      'motion', 'highlightMode', 'safe', 'y', 'speed', 'outline', 'outlineColor', 'secondaryColor', 'shadow']
    const design = Object.fromEntries(keys.filter(key => Object.hasOwn(appearance ?? {}, key)).map(key => [key, appearance[key]]))
    validateOverlay({ cues: [exampleCue], appearance: design })
    return { name: name.trim(), appearance: design }
  }
  async function templates() {
    try {
      if ((await stat(shelf)).size > 32768) throw new Error('badTemplate')
      const rows = JSON.parse(await readFile(shelf, 'utf8'))
      if (!Array.isArray(rows) || rows.length > 30) throw new Error('badTemplate')
      return rows.map(template)
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }
  async function writeStudioFile(path, content) {
    const part = join(dirname(path), '.viralcut-studio-' + randomBytes(12).toString('hex') + '.tmp')
    try {
      await writeFile(part, content, { flag: 'wx', flush: true })
      await rename(part, path)
    } finally { await unlink(part).catch(() => {}) }
  }
  let templateWrites = Promise.resolve()
  safeHandle('studio-templates', async () => ({ templates: await templates() }))
  safeHandle('studio-template-save', value => {
    const item = template(value)
    const pending = templateWrites.then(async () => {
      const rows = await templates()
      const next = [...rows.filter(row => row.name !== item.name), item]
      if (next.length > 30) return { error: 'templateLimit' }
      await writeStudioFile(shelf, JSON.stringify(next))
      return { templates: next }
    })
    templateWrites = pending.catch(() => {})
    return pending
  })
  safeHandle('studio-cover-save', async ({ format, bytes, language } = {}) => {
    if (!['png', 'jpg'].includes(format) || !['tr', 'en'].includes(language) || !(bytes instanceof Uint8Array) ||
        bytes.byteLength < 32 || bytes.byteLength > 16 * 1024 * 1024) return { error: 'badCover' }
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const signature = format === 'png' ? '89504e470d0a1a0a' : 'ffd8ff'
    if (!data.subarray(0, signature.length / 2).equals(Buffer.from(signature, 'hex'))) return { error: 'badCover' }
    const result = await dialog.showSaveDialog(win, { title: language === 'tr' ? 'Kapak görselini kaydet' : 'Save cover image',
      defaultPath: join(app.getPath('pictures'), `ViralCut-cover.${format}`), filters: [{ name: format.toUpperCase(), extensions: [format] }] })
    if (result.canceled || !result.filePath) return { cancelled: true }
    const path = result.filePath
    if (!localPath(path) || extname(path).toLowerCase() !== '.' + format) return { error: 'badCover' }
    await writeStudioFile(path, data)
    return { saved: true }
  }, true)
  safeHandle('media-add', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Zaman çizelgesine video ekle',
      filters: mediaFilter, properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return { cancelled: true }
    const entries = await Promise.allSettled(result.filePaths.slice(0, 100).map(path => projects.register(path)))
    return { media: entries.filter(entry => entry.status === 'fulfilled').map(entry => entry.value),
      rejected: result.filePaths.length - entries.filter(entry => entry.status === 'fulfilled').length }
  }, true)
  safeHandle('shorts-source', async language => {
    if (!['tr', 'en'].includes(language)) return { error: 'badRequest' }
    const result = await dialog.showOpenDialog(win, { title: language === 'tr' ? 'Shorts için video seç' : 'Choose a video for Shorts',
      filters: mediaFilter, properties: ['openFile'] })
    return result.canceled ? { cancelled: true } : { media: await projects.register(result.filePaths[0]) }
  }, true)
  safeHandle('shorts-batch', async request => {
    if (request?.creator) return { error: 'badEdit' }
    if (!batchSize(request) || typeof request.mediaId !== 'string' || !idPattern.test(request.mediaId) ||
        !['tr', 'en'].includes(request.language) || Buffer.byteLength(JSON.stringify(request)) > 1024 * 1024) return { error: 'badEdit' }
    if (service.batchStatus().active) return { error: 'busy' }
    const result = await dialog.showOpenDialog(win, { title: request.language === 'tr' ? 'Shorts MP4 kayıt klasörü' : 'Save Shorts MP4s to a folder',
      defaultPath: app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || quitting) return { cancelled: true }
    try {
      const path = result.filePaths[0]
      if (!localPath(path)) return { error: 'saveFailed' }
      const directory = await realpath(path)
      if (!localPath(directory) || !(await stat(directory)).isDirectory()) return { error: 'saveFailed' }
      return { ...await service.startBatch(request, directory), folder: directory }
    } catch (error) { return { error: error instanceof ExportError ? error.message : 'saveFailed' } }
  }, true)
  safeHandle('shorts-status', () => service.batchStatus())
  safeHandle('shorts-cancel', () => service.cancelBatch())
  let directorFolder, music
  let directorOutput
  let directorBatch
  let resourceStart
  let operationResources
  let preparingDirector = false
  safeHandle('director-music', async language => {
    if (!['tr', 'en'].includes(language) || preparingDirector || service.batchStatus().active) return { error: 'busy' }
    const formats = { '.mp3': 'mp3', '.wav': 'wav', '.m4a': 'mov', '.flac': 'flac' }
    const result = await dialog.showOpenDialog(win, { title: language === 'tr' ? 'Kullanım hakkına sahip olduğun müziği seç' : 'Choose music you have rights to use',
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'flac'] }], properties: ['openFile'] })
    if (result.canceled) return {}
    const selected = result.filePaths[0]
    if (!localPath(selected)) return { error: 'badSource' }
    const path = await realpath(selected)
    const format = formats[extname(path).toLowerCase()]
    const info = await stat(path)
    if (!localPath(path) || !format || !info.isFile() || !info.size) return { error: 'badSource' }
    music = { path, format }
    return { name: basename(path) }
  }, true)
  safeHandle('director-folder', async language => {
    if (!['tr', 'en'].includes(language) || preparingDirector || service.batchStatus().active) return { error: 'busy' }
    const result = await dialog.showOpenDialog(win, {
      title: language === 'tr' ? 'AI düzenleme çıktı klasörü' : 'AI Director output folder',
      defaultPath: app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'],
    })
    directorFolder = result.canceled ? undefined : result.filePaths[0]
    resourceStart = process.cpuUsage()
    operationResources = { memoryMiB: 0, cpuSeconds: 0 }
    return { cancelled: result.canceled }
  }, true)
  safeHandle('director-start', async request => {
    if (request?.creator) return { error: 'badEdit' }
    if (!directorFolder || preparingDirector || service.batchStatus().active) return { error: 'busy' }
    if (!batchSize(request) || !idPattern.test(request.mediaId) || Buffer.byteLength(JSON.stringify(request)) > 1024 * 1024) return { error: 'badEdit' }
    preparingDirector = true
    try {
      const result = await prepareDirector(request, directorFolder, projects)
      directorOutput = result
      directorBatch = undefined
      directorPreview = undefined
      try {
        directorBatch = await service.startBatch(request, result.folder, true, request.useMusic === true ? music : undefined)
        directorPreview = file => service.batchStatus().id === directorBatch?.id &&
          service.batchStatus().items.some(item => item.phase === 'ready' && item.filename === file) ? join(result.folder, file) : undefined
        return { ...directorBatch, ...result }
      }
      catch (error) { return { ...result, error: error instanceof ExportError ? error.message : 'saveFailed' } }
    } catch (error) { return { error: error instanceof ExportError ? error.message : 'saveFailed' } }
    finally { preparingDirector = false }
  })
  safeHandle('director-status', () => {
    const result = service.batchStatus()
    if (directorBatch && result.id === directorBatch.id) directorBatch = result
    if (resourceStart && operationResources) {
      const cpu = process.cpuUsage(resourceStart)
      operationResources.cpuSeconds = (cpu.user + cpu.system) / 1e6
      operationResources.memoryMiB = Math.max(operationResources.memoryMiB, Math.round(process.memoryUsage.rss() / 1048576))
    }
    return { ...(directorBatch ?? { active: false, items: [] }), resources: operationResources }
  })
  safeHandle('director-cancel', () => {
    if (directorBatch?.id === service.batchStatus().id) service.cancelBatch()
    return {}
  })
  safeHandle('director-reveal', async file => {
    if (!directorOutput) return {}
    if (file === '') return { opened: !await shell.openPath(directorOutput.folder) }
    if (typeof file !== 'string' || !/^ViralCut-Short-[a-f0-9]{8}\.mp4$/.test(file) ||
        !directorBatch?.items.some(item => item.phase === 'ready' && item.filename === file)) return {}
    return { opened: !await shell.openPath(join(directorOutput.folder, file)) }
  })
  safeHandle('director-project', async index => {
    const path = Number.isInteger(index) && directorOutput?.projectFiles[index]
    return path ? { project: await projects.open(path) } : { error: 'badProject' }
  })
  safeHandle('media-relink', async id => {
    if (typeof id !== 'string' || !idPattern.test(id)) return { error: 'badProject' }
    const result = await dialog.showOpenDialog(win, { title: 'Orijinal videonun yeni konumunu seç',
      filters: mediaFilter, properties: ['openFile'] })
    return result.canceled ? { cancelled: true } : { media: await projects.relink(id, result.filePaths[0]) }
  }, true)
  safeHandle('project-open', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'ViralCut projesini aç',
      filters: projectFilter, properties: ['openFile'] })
    return result.canceled ? { cancelled: true } : { project: await projects.open(result.filePaths[0]) }
  }, true)
  safeHandle('project-save', async state => {
    const result = await dialog.showSaveDialog(win, { title: 'ViralCut projesini kaydet',
      defaultPath: join(app.getPath('documents'), 'ViralCut.viralcut'), filters: projectFilter })
    if (result.canceled) return { cancelled: true }
    const path = result.filePath.toLowerCase().endsWith('.viralcut') ? result.filePath : result.filePath + '.viralcut'
    await projects.save(path, state)
    return { filename: basename(path) }
  }, true)
  safeHandle('project-autosave', async state => {
    if (!settings.read().interval) return { disabled: true }
    await projects.autosave(state)
    return { saved: true }
  })
  safeHandle('project-has-recovery', () => projects.recovery())
  safeHandle('project-recover', async () => ({ project: await projects.recover() }))
  for (const [channel, operation] of [['start', 'start'], ['status', 'status'], ['cancel', 'cancel']]) {
    safeHandle('preview-' + channel, ({ id, type } = {}) => {
      if (typeof id !== 'string' || !idPattern.test(id) || !['waveform', 'proxy'].includes(type)) return { error: 'badMedia' }
      return previews[operation](id, type)
    })
  }

  ipcMain.handle('viralcut:choose-model', async (event, language) => {
    if (!trusted(event) || choosingModel || !['tr', 'en'].includes(language)) return 'error'
    choosingModel = true
    try {
      const result = await dialog.showOpenDialog(win, {
        title: language === 'tr' ? 'Whisper Base Q5 modelini seç' : 'Choose the Whisper Base Q5 model',
        properties: ['openFile'], filters: [{ name: 'Whisper GGML', extensions: ['bin'] }],
      })
      if (result.canceled || !trusted(event)) return 'cancelled'
      const [path] = result.filePaths
      if (!localPath(path) || !localPath(await realpath(path)) || !await modelVerified(path)) return 'invalid'
      if (!trusted(event)) return 'cancelled'
      const folder = app.getPath('userData')
      await mkdir(folder, { recursive: true })
      const pending = join(folder, 'model.json.tmp')
      await writeFile(pending, JSON.stringify({ path }), 'utf8')
      await rename(pending, join(folder, 'model.json'))
      process.env.VIRALCUT_MODEL = path
      return 'ready'
    } catch {
      return 'error'
    } finally {
      choosingModel = false
    }
  })
  ipcMain.handle('viralcut:save-clip', async (event, id, filename, language) => {
    if (!trusted(event) || typeof id !== 'string' || !idPattern.test(id) ||
        !safeFilename(filename) || !['tr', 'en'].includes(language) || saving) return { error: 'saveFailed' }
    if (!service.hasExport(id)) return { error: 'jobMissing' }
    saving = true
    try {
      const destination = await dialog.showSaveDialog(win, {
        title: language === 'tr' ? 'MP4 olarak kaydet' : 'Save as MP4',
        defaultPath: join(app.getPath('downloads'), filename),
        filters: [{ name: 'MP4', extensions: ['mp4'] }],
      })
      if (destination.canceled || !trusted(event)) return { cancelled: true }
      const path = destination.filePath.toLowerCase().endsWith('.mp4') ? destination.filePath : destination.filePath + '.mp4'
      if (!localPath(path) || !localPath(await realpath(dirname(path)))) return { error: 'saveFailed' }
      if (await projects.protects(path)) return { error: 'sourceProtected' }
      await service.saveExport(id, path)
      return { filename: basename(path) }
    } catch (error) {
      const code = error.message === 'jobMissing' ? 'jobMissing' : error.code === 'ENOSPC' ? 'diskFull'
        : ['EACCES', 'EPERM', 'EROFS'].includes(error.code) ? 'accessDenied' : 'saveFailed'
      diagnostics.record('save-clip', 'failed', undefined, code)
      return { error: code }
    } finally {
      saving = false
    }
  })
}

async function startServer() {
  const dist = join(root, 'dist')
  await stat(join(dist, 'index.html'))
  const assets = await readdir(join(dist, 'assets'), { withFileTypes: true })
  const files = new Map([['/', join(dist, 'index.html')], ['/viralcut.svg', join(dist, 'viralcut.svg')]])
  for (const item of assets) {
    if (item.isFile() && types[extname(item.name)]) files.set('/assets/' + item.name, join(dist, 'assets', item.name))
  }
  service = createExportService({ desktop: true, resolveMedia: projects.resolveMedia,
    record: diagnostics.record, onHeavyWork: previews.prioritize, cache, budget, decode: performanceMonitor.decode,
    onProviders: performanceMonitor.providers, toolsReady: true })
  web = createServer((req, res) => {
    const key = req.headers['x-viralcut-desktop']
    if (!origin || req.headers.host !== new URL(origin).host || typeof key !== 'string' ||
        key.length !== secret.length || !/^[0-9a-f]+$/.test(key) || !timingSafeEqual(Buffer.from(key), Buffer.from(secret))) {
      return res.writeHead(403).end()
    }
    res.setHeader('Content-Security-Policy', csp)
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const media = /^\/(project-media|preview-media)\/([a-f0-9-]{36})$/.exec(req.url)
    const creator = /^\/creator-render\/((?:youtube|tiktok|instagram)-[a-f0-9]{8}\.mp4)$/.exec(req.url)
    if (creator) {
      if (!creatorOutput?.batch.items.some(item => item.phase === 'ready' && item.filename === creator[1])) return res.writeHead(404).end()
      void projects.stream(req, res, undefined, join(creatorOutput.folder, creator[1])).catch(() => res.destroy())
      return
    }
    const rendered = /^\/studio-render\/(ViralCut-Short-[a-f0-9]{8}\.mp4)$/.exec(req.url)
    if (rendered) {
      const path = directorPreview?.(rendered[1])
      if (!path) return res.writeHead(404).end()
      void projects.stream(req, res, undefined, path).catch(() => res.destroy())
      return
    }
    if (media && idPattern.test(media[2])) {
      const proxy = media[1] === 'preview-media' ? previews.proxy(media[2]) : undefined
      if (media[1] === 'preview-media' && !proxy) return res.writeHead(404).end()
      void projects.stream(req, res, media[2], proxy).catch(() => {
        if (res.headersSent) res.destroy()
        else res.writeHead(500).end()
      })
      return
    }
    service.middleware(req, res, () => {
      const file = files.get(req.url)
      if (req.method !== 'GET' || !file) return res.writeHead(404).end()
      res.setHeader('Content-Type', types[extname(file)])
      createReadStream(file).on('error', () => res.destroy()).pipe(res)
    }, web.address())
  })
  await new Promise((resolve, reject) => {
    web.once('error', reject)
    web.listen(0, '127.0.0.1', resolve)
  })
  origin = 'http://127.0.0.1:' + web.address().port
}

async function openEditor() {
  const profile = app.getPath('userData')
  const previous = join(previousProfile, 'project-recovery-v18.viralcut')
  ;[diagnostics, settings] = await Promise.all([createDiagnostics(profile), betaSettings(profile)])
  markClean = await startSessionMarker(profile, diagnostics.record)
  calendar = createCalendar(profile, previousProfile)
  youtube = createYouTube({ folder: profile, storage: safeStorage, openBrowser: shell.openExternal })
  configureTools()
  const [tools, speech] = await Promise.all([checkTools({ subtitles: true }), configureModel().then(() => whisperAvailability({ verify: true }))])
  if (!tools) throw new Error('Paketin FFmpeg veya FFprobe dosyaları çalışmadı. Uygulamayı yeniden kurmayı deneyin.')
  projects = createProjectStore(join(profile, 'project-recovery-beta.viralcut'), previous)
  previews = createPreviewQueue(projects.resolveMedia, diagnostics.record)
  cache = createAnalysisCache(join(app.getPath('userData'), 'analysis-v18'))
  budget = createResourceBudget()
  performanceMonitor = createPerformanceMonitor(app)
  await startServer()
  const editorSession = session.fromPartition('viralcut-editor')
  editorSession.setPermissionRequestHandler((contents, permission, reply, details) => {
    const granted = permission === 'media' && contents === win?.webContents && details.isMainFrame &&
      new URL(details.requestingUrl, origin).origin === origin && details.mediaTypes?.length === 1 &&
      details.mediaTypes[0] === 'audio' && Date.now() < microphoneUntil
    if (granted) microphoneUntil = 0
    reply(granted)
  })
  editorSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    permission === 'media' && contents === win?.webContents && details.isMainFrame && details.mediaType === 'audio' &&
    requestingOrigin === origin && Date.now() < microphoneUntil)
  editorSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, reply) => {
    if (details.url.startsWith('blob:' + origin + '/')) return reply({})
    reply({ cancel: !details.url.startsWith(origin + '/') })
  })
  editorSession.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1/*'] }, (details, reply) => {
    if (!win || details.webContentsId !== win.webContents.id || !details.url.startsWith(origin + '/')) return reply({ cancel: true })
    reply({ requestHeaders: { ...details.requestHeaders, 'X-ViralCut-Desktop': secret } })
  })
  Menu.setApplicationMenu(null)
  win = new BrowserWindow({
    title: 'ViralCut AI v' + app.getVersion().replace(/-beta$/, ' Beta'), width: 1400, height: 900, minWidth: 360, minHeight: 520,
    backgroundColor: '#101212', show: false,
    icon: app.isPackaged ? join(resources, 'icon.ico') : join(root, 'desktop', 'icon.ico'),
    webPreferences: {
      session: editorSession, preload: join(root, 'desktop', 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
  registerDialogs()
  win.on('close', event => {
    if (quitting || win.webContents.isCrashed()) return
    event.preventDefault()
    if (closeRequested) return
    closeRequested = true
    closeTimer = setTimeout(() => app.quit(), 3500)
    win.webContents.send('viralcut:flush-recovery')
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-attach-webview', event => event.preventDefault())
  win.webContents.on('render-process-gone', () => {
    diagnostics.record('renderer', 'failed', undefined, 'rendererGone')
    if (!quitting) dialog.showErrorBox('ViralCut AI Desktop', 'Editör penceresi beklenmedik şekilde durdu. Uygulamayı kapatıp yeniden açın.')
  })
  win.webContents.on('will-frame-navigate', event => event.preventDefault())
  await win.loadURL(origin + '/')
  win.show()
  if (!speech.enginePresent) {
    void dialog.showMessageBox(win, {
      type: 'warning', title: 'Whisper.cpp başlatılamadı',
      message: 'Otomatik altyazı motoru başlatılamadı.',
      detail: 'Windows için Microsoft Visual C++ 2015–2022 x64 çalışma zamanını kontrol edin. Video kesme ve MP4 dışa aktarma kullanılabilir.',
    })
  }
}

async function shutdown() {
  clearTimeout(closeTimer)
  const stopped = web?.listening && new Promise(resolve => {
    web.close(resolve)
    web.closeAllConnections()
  })
  await Promise.allSettled([stopped, service?.close(), previews?.close(), projects?.settled(), performanceMonitor?.close(),
    calendar?.settled(), youtube?.close(), settings?.settled()])
  await diagnostics?.settled()
  await markClean?.()
}

app.setAppUserModelId('com.viralcut.desktop.v18beta')
if (app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'ViralCut AI Beta'))
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', event => {
    if (quitting) { event.preventDefault(); return }
    event.preventDefault()
    quitting = true
    void shutdown().finally(() => app.exit(0))
  })
  app.whenReady().then(openEditor).catch(error => {
    if (quitting) return
    dialog.showErrorBox('ViralCut AI Desktop açılamadı', error.message)
    diagnostics?.record('startup', 'failed', undefined, 'startupFailed')
    quitting = true
    void shutdown().finally(() => app.exit(1))
  })
}
