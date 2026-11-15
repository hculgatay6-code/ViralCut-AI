import { Worker } from 'node:worker_threads'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { stat } from 'node:fs/promises'
import { ExportError } from './media.mjs'

export function createVisualService() {
  let cached
  async function analyze({ input, format, duration, signal, onProgress, device = 'auto' }) {
    signal.throwIfAborted()
    const folder = process.env.VIRALCUT_VISION_MODEL ?? join(process.env.LOCALAPPDATA ?? homedir(), 'ViralCutAI', 'vision-v13')
    const stats = await Promise.all([input, join(folder, 'ssd_mobilenet_v1_12-int8.onnx'), join(folder, 'version-slim-320.onnx')]
      .map(path => stat(path, { bigint: true }).then(s => [s.size, s.mtimeNs, s.ctimeNs].join(':')).catch(() => 'missing')))
    const key = [input, folder, device, ...stats].join('|')
    if (cached?.key === key) { onProgress(100); return cached.value }
    const value = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./vision-worker.mjs', import.meta.url))
      let output
      const abort = () => worker.postMessage('cancel')
      signal.addEventListener('abort', abort, { once: true })
      worker.on('message', message => {
        if (message.progress !== undefined) onProgress(message.progress)
        else output = message.visual
      })
      worker.once('error', () => { output = undefined })
      worker.once('exit', () => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) reject(signal.reason)
        else if (output) resolve(output)
        else reject(new ExportError('visualDecodeFailed'))
      })
      // Electron runs this worker outside ASAR; resolve only runtime tools from the main process.
      worker.postMessage({ input, format, duration, folder, device, ffmpeg: process.env.VIRALCUT_FFMPEG ??
        (process.env.VIRALCUT_FFPROBE ? join(dirname(process.env.VIRALCUT_FFPROBE), 'ffmpeg.exe') : 'ffmpeg') })
      if (signal.aborted) abort()
    })
    cached = { key, value }
    return value
  }
  analyze.clear = () => { cached = undefined }
  return analyze
}
