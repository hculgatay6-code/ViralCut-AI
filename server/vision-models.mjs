import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { InferenceSession, Tensor } from 'onnxruntime-node'

export const visionModels = [
  ['ssd_mobilenet_v1_12-int8.onnx', 9540809, '2b79e6a7fb1ec6a33f332b9b10d82d9de4b7b49dcd26b5946921bb356895c954'],
  ['version-slim-320.onnx', 1195330, 'e9adbd0f920ddcce9368434c4d34d72520dc0c19b526fd44b4ef49bde2c3b1a8'],
]
const coco = 'person,bicycle,car,motorcycle,airplane,bus,train,truck,boat,traffic light,fire hydrant,,stop sign,parking meter,bench,bird,cat,dog,horse,sheep,cow,elephant,bear,zebra,giraffe,,backpack,umbrella,,,handbag,tie,suitcase,frisbee,skis,snowboard,sports ball,kite,baseball bat,baseball glove,skateboard,surfboard,tennis racket,bottle,,wine glass,cup,fork,knife,spoon,bowl,banana,apple,sandwich,orange,broccoli,carrot,hot dog,pizza,donut,cake,chair,couch,potted plant,bed,,dining table,,,toilet,,tv,laptop,mouse,remote,keyboard,cell phone,microwave,oven,toaster,sink,refrigerator,,book,clock,vase,scissors,teddy bear,hair drier,toothbrush'.split(',')
const boxValue = value => Math.max(0, Math.min(1, value))
export function overlap(a, b) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  return w * h / Math.max(.000001, area(a) + area(b) - w * h)
}
export const area = box => (box.right - box.left) * (box.bottom - box.top)
function detection(label, score, left, top, right, bottom) {
  return { label, score, left: boxValue(left), top: boxValue(top), right: boxValue(right), bottom: boxValue(bottom) }
}

export async function openVisionModels(folder, device = 'auto') {
  const sessions = []
  const status = []
  for (const [index, [filename, size, sha]] of visionModels.entries()) {
    let buffer
    try {
      const path = join(folder, filename)
      if ((await stat(path)).size !== size) throw new Error('integrity')
      buffer = await readFile(path)
      if (buffer.length !== size || createHash('sha256').update(buffer).digest('hex') !== sha) throw new Error('integrity')
    } catch (error) {
      status.push(error.code === 'ENOENT' ? 'missing' : 'invalid')
      sessions.push(undefined)
      continue
    }
    const options = { intraOpNumThreads: 2, interOpNumThreads: 1, enableMemPattern: false, logSeverityLevel: 3 }
    // INT8 SSD carries CPU-oriented quantized operators. DirectML is tried for the face model.
    if (index === 1 && device === 'auto' && process.platform === 'win32') {
      let dml
      try {
        dml = await InferenceSession.create(buffer, { ...options, executionMode: 'sequential', executionProviders: ['dml'] })
        await dml.run({ input: new Tensor('float32', new Float32Array(320 * 240 * 3), [1, 3, 240, 320]) })
        sessions.push(dml); status.push('dml'); continue
      } catch { await dml?.release().catch(() => {}) }
    }
    try {
      sessions.push(await InferenceSession.create(buffer, { ...options, executionProviders: ['cpu'] }))
      status.push('cpu')
    } catch { sessions.push(undefined); status.push('failed') }
  }
  const pixels = 320 * 240
  const plane = new Float32Array(pixels * 3)
  return {
    status,
    async detect(rgb) {
      const boxes = []
      if (sessions[0]) {
        const output = await sessions[0].run({ inputs: new Tensor('uint8', rgb, [1, 240, 320, 3]) })
        const count = Math.min(output.num_detections.data[0], 100)
        for (let i = 0; i < count; i++) {
          const label = coco[output.detection_classes.data[i] - 1], score = output.detection_scores.data[i]
          if (!label || score < .5) continue
          const [top, left, bottom, right] = output.detection_boxes.data.subarray(i * 4, i * 4 + 4)
          boxes.push(detection(label, score, left, top, right, bottom))
        }
      }
      if (sessions[1]) {
        for (let i = 0; i < pixels; i++) {
          for (let c = 0; c < 3; c++) plane[c * pixels + i] = (rgb[i * 3 + c] - 127) / 128
        }
        const { scores, boxes: coordinates } = await sessions[1].run({ input: new Tensor('float32', plane, [1, 3, 240, 320]) })
        const faces = []
        for (let i = 0; i < scores.data.length / 2; i++) if (scores.data[i * 2 + 1] >= .8) {
          faces.push(detection('face', scores.data[i * 2 + 1], ...coordinates.data.subarray(i * 4, i * 4 + 4)))
        }
        for (const face of faces.sort((a, b) => b.score - a.score)) {
          if (area(face) > .001 && !boxes.some(box => box.label === 'face' && overlap(face, box) > .35)) boxes.push(face)
        }
      }
      return boxes.filter(box => area(box) > .0005).sort((a, b) => b.score - a.score).slice(0, 15)
    },
    async close() { await Promise.allSettled(sessions.filter(Boolean).map(session => session.release())) },
  }
}
