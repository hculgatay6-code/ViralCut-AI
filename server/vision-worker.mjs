import { parentPort } from 'node:worker_threads'
import { spawn } from 'node:child_process'
import { inputOptions } from './media.mjs'
import { openVisionModels } from './vision-models.mjs'

const width = 320, height = 240, bytes = width * height * 3

parentPort.once('message', async options => {
  const { input, format, duration, ffmpeg, folder, device } = options
  const step = Math.max(.5, duration / 3600)
  const detectEvery = Math.max(1, Math.ceil(2 / step), Math.ceil(duration / step / 650))
  const rows = [], detections = []
  let model, child
  let cancelled = false
  parentPort.on('message', type => {
    if (type === 'cancel') { cancelled = true; child?.kill() }
  })
  let previous, previousMotion = 0, lastCut = -10
  const frame = new Uint8Array(bytes)
  let small = new Uint8Array(80 * 60)
  try {
    model = await openVisionModels(folder, device)
    if (cancelled) return
    child = spawn(ffmpeg, ['-v', 'error', '-nostdin', '-threads', '2', '-filter_threads', '1',
      ...inputOptions(format), '-i', input, '-map', '0:V:0', '-an',
      '-vf', `fps=${(1 / step).toFixed(8)}:start_time=0,scale=320:240:flags=fast_bilinear,format=rgb24`,
      '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const result = new Promise(resolve => {
      child.once('error', () => resolve(-1))
      child.once('close', resolve)
    })
    let count = 0
    for await (const chunk of child.stdout) {
      if (cancelled) break
      let cursor = 0
      while (cursor < chunk.length) {
        const length = Math.min(bytes - count, chunk.length - cursor)
        frame.set(chunk.subarray(cursor, cursor + length), count)
        count += length; cursor += length
        if (count < bytes) continue
        count = 0
        const index = rows.length, time = index * step
        const bins = Array(16).fill(0)
        let difference = 0, sum = 0, bright = 0, tint = 0
        for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) {
          const pixel = (y * 4 * width + x * 4) * 3, point = y * 80 + x
          const light = (77 * frame[pixel] + 150 * frame[pixel + 1] + 29 * frame[pixel + 2]) >> 8
          small[point] = light; bins[light >> 4]++
          sum += light
          if (light >= 244) bright++
          if (light > 45 && light < 235) tint += frame[pixel] - frame[pixel + 2]
          if (previous) difference += Math.abs(light - previous[point])
        }
        const motion = Math.min(1, difference / (4800 * 45))
        const histogram = bins.map(value => value / 4800)
        const prior = rows.at(-1)
        const change = prior && histogram.reduce((sum, value, i) => sum + Math.abs(value - prior.histogram[i]), 0)
        const cut = time - lastCut >= 1 && motion > .46 && change > .35
        const burst = !cut && motion > .3 && motion - previousMotion > .17
        const labels = []
        if (model.status.some(value => value === 'cpu' || value === 'dml') &&
            (index % detectEvery === 0 || (cut && detections.length < 650)) && detections.length < 900) {
          const boxes = await model.detect(frame).catch(() => {
            model.status = model.status.map(value => ['dml', 'cpu'].includes(value) ? 'failed' : value)
            return []
          })
          detections.push({ time, boxes })
          labels.push(...new Set(boxes.map(box => box.label)))
        }
        rows.push({ time, histogram, motion, cut, burst, labels, light: sum / 4800, bright: bright / 4800, tint: tint / 4800 })
        if (cut) lastCut = time
        const next = previous ?? new Uint8Array(80 * 60)
        previous = small; small = next; previousMotion = motion
        if (index % 8 === 0) parentPort.postMessage({ progress: Math.min(99, time / duration * 100) })
      }
    }
    if (await result || !rows.length) throw new Error('visualDecodeFailed')
    if (cancelled) return
    parentPort.postMessage({ visual: { rows, detections, models: model.status, step, detectionStep: step * detectEvery } })
  } catch {
    child?.kill()
    parentPort.postMessage({ error: 'visualDecodeFailed' })
  } finally {
    await model?.close()
    parentPort.close()
  }
})
