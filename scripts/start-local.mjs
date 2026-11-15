import { spawn, spawnSync } from 'node:child_process'
import { access, readdir } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { delimiter, join } from 'node:path'
import { preview } from 'vite'
import { instanceId } from '../server/instance.mjs'
import { checkTools } from '../server/media.mjs'

const port = 4173
const url = 'http://127.0.0.1:' + port
const headers = { 'X-ViralCut': '2' }

async function prepareMediaPath() {
  if (await checkTools({ subtitles: true })) return
  const local = process.env.LOCALAPPDATA
  if (!local) return
  const packages = join(local, 'Microsoft', 'WinGet', 'Packages')
  const directories = await readdir(packages).catch(() => [])
  const folders = directories.filter(name => /^Gyan\.FFmpeg_Microsoft\.Winget\.Source_/i.test(name))
  for (const folder of folders) {
    const parent = join(packages, folder)
    const versions = await readdir(parent).catch(() => [])
    for (const version of versions.filter(name => name.startsWith('ffmpeg-'))) {
      const bin = join(parent, version, 'bin')
      const executables = await Promise.allSettled(['ffmpeg.exe', 'ffprobe.exe'].map(name => access(join(bin, name))))
      if (executables.some(result => result.status !== 'fulfilled')) continue
      const original = process.env.Path ?? process.env.PATH ?? ''
      process.env.Path = bin + delimiter + original
      if (await checkTools({ subtitles: true })) return
      process.env.Path = original
    }
  }
}

function occupied(host) {
  return new Promise(resolve => {
    const socket = createConnection({ host, port })
    const finish = listening => { socket.destroy(); resolve(listening) }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(1500, () => finish(false))
  })
}

async function health() {
  try {
    const response = await fetch(url + '/api/export/health', { headers, signal: AbortSignal.timeout(15000) })
    if (response.ok && response.headers.get('content-type')?.startsWith('application/json')) {
      const result = await response.json()
      if (result.instanceId === instanceId) return result
    }
  } catch {
    // A different listener may accept a TCP connection without serving this API.
  }
}

function ensureReady(status) {
  if (!status?.ffmpeg) throw new Error('FFmpeg veya FFprobe çalışmadı. PATH üzerinde libx264, AAC ve libass destekli FFmpeg kurulumunu kontrol edin.')
  if (!status.whisper?.modelPresent) throw new Error('Yerel Whisper Base Q5 modeli eksik veya özeti uyuşmuyor. README.md içindeki onaylı model kurulumuna bakın.')
  if (!status.whisper.enginePresent) throw new Error('Whisper.cpp çalışmadı. README.md içindeki CPU motoru kurulumuna bakın.')
}

async function openBrowser() {
  if (process.env.BROWSER === 'none') return
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url + '/'], {
    windowsHide: true, stdio: 'ignore',
  })
  await new Promise((resolve, reject) => {
    browser.once('error', reject)
    browser.once('close', code => code === 0 ? resolve() : reject(new Error('Tarayıcı açılamadı.')))
  }).catch(() => console.warn('Tarayıcı otomatik açılamadı. Adresi elle açın: ' + url + '/'))
}

let server
try {
  const [ipv4, ipv6] = await Promise.all([occupied('127.0.0.1'), occupied('::1')])
  if (ipv4 || ipv6) {
    const status = ipv4 && await health()
    if (!status) throw new Error('4173 portu kullanımda. Bu projeye ait güncel ViralCut servisi doğrulanamadı. Eski bir ViralCut penceresi açıksa yalnızca o pencereyi kapatıp tekrar deneyin.')
    ensureReady(status)
    console.log('Bu projeye ait ViralCut zaten çalışıyor: ' + url + '/')
  } else {
    await prepareMediaPath()
    const build = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npm.cmd', 'run', 'build'], { stdio: 'inherit' })
    if (build.error || build.status !== 0) throw new Error('Uygulama derlenemedi. Yukarıdaki derleme hatasını kontrol edin.')
    server = await preview({ preview: { strictPort: true, open: false } })
    const status = await health()
    if (!status) throw new Error('Yerel web arayüzü başladı ancak işleme servisi yanıt vermedi.')
    ensureReady(status)
    console.log('ViralCut hazır. FFmpeg ve Whisper doğrulandı: ' + url + '/')
  }
  await openBrowser()
} catch (error) {
  if (server) await new Promise(resolve => {
    server.httpServer.close(resolve)
    server.httpServer.closeAllConnections()
  })
  console.error('ViralCut başlatılamadı. ' + (error.code === 'EADDRINUSE'
    ? '4173 portu kullanımda. Arka plandaki işlemleri değiştirmeden tekrar deneyin.' : error.message))
  process.exitCode = 1
}
