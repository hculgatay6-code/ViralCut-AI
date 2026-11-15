import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { rankSemantic, speechUnits } from './semantic-ranking.mjs'
import { semanticStamp } from './semantic-model.mjs'

export function createSemanticService() {
  let worker, idle, revision
  function close() {
    clearTimeout(idle)
    const active = worker
    worker = undefined
    return active?.terminate()
  }
  return {
    close,
    async analyze(data, signal, onProgress) {
      signal.throwIfAborted()
      clearTimeout(idle)
      const id = randomUUID()
      const control = new SharedArrayBuffer(4)
      let killTimer
      try {
        const stamp = await semanticStamp()
        signal.throwIfAborted()
        if (worker && revision !== stamp) await close()
        revision = stamp
        worker ??= new Worker(new URL('./semantic-worker.mjs', import.meta.url))
        const thread = worker
        return await new Promise((resolve, reject) => {
          const abort = () => {
            Atomics.store(new Int32Array(control), 0, 1)
            killTimer = setTimeout(() => { if (worker === thread) void close() }, 5000)
          }
          const clean = () => {
            signal.removeEventListener('abort', abort)
            thread.off('message', receive); thread.off('error', fail); thread.off('exit', exit)
            clearTimeout(killTimer)
          }
          const fail = error => { clean(); if (worker === thread) void close(); reject(error) }
          const exit = () => fail(new Error('semanticWorker'))
          const receive = message => {
            if (message.id !== id) return
            if (message.progress) { onProgress(message.progress); return }
            clean()
            if (signal.aborted || !message.result) reject(signal.reason ?? new Error('semanticWorker'))
            else resolve(message.result)
          }
          thread.on('message', receive); thread.once('error', fail); thread.once('exit', exit)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
          thread.postMessage({ ...data, id, control })
        })
      } catch {
        signal.throwIfAborted()
        const units = speechUnits(data.cues, data.duration)
        return { mode: 'rules', reason: 'modelFailed', candidates: (data.goal === 0 ? [15, 30, 60] : [data.goal]).flatMap(length =>
          rankSemantic(units, null, data.silences, data.duration, length, () => signal.throwIfAborted(),
            data.signals, data.visualRows, data.director ? 10 : 5)) }
      } finally {
        if (worker) { idle = setTimeout(() => { void close() }, 90000); idle.unref() }
      }
    },
  }
}
