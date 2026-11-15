import { parentPort } from 'node:worker_threads'
import { loadSemanticModel } from './semantic-model.mjs'
import { rankSemantic, speechUnits } from './semantic-ranking.mjs'

let model
parentPort.on('message', async ({ id, cues, silences, duration, goal, control, signals, visualRows, director }) => {
  const flag = new Int32Array(control)
  const check = () => { if (Atomics.load(flag, 0)) throw new Error('cancelled') }
  try {
    const units = speechUnits(cues, duration)
    let mode = 'rules', reason = 'noSpeech', vectors
    if (units.length) {
      try {
        model ??= loadSemanticModel().catch(error => { model = undefined; throw error })
        const embed = await model
        vectors = []
        for (let index = 0; index < units.length; index += 8) {
          check()
          vectors.push(...await embed(units.slice(index, index + 8).map(unit => unit.text)))
          parentPort.postMessage({ id, progress: 90 + 9 * Math.min(1, (index + 8) / units.length) })
        }
        mode = 'e5'; reason = undefined
      } catch (error) {
        check()
        vectors = undefined
        reason = error.code === 'ENOENT' ? 'modelMissing' : error.message === 'modelIntegrity' ? 'modelIntegrity' : 'modelFailed'
      }
    }
    check()
    const candidates = (goal === 0 ? [15, 30, 60] : [goal]).flatMap(length =>
      rankSemantic(units, vectors, silences, duration, length, check, signals, visualRows, director ? 10 : 5))
    parentPort.postMessage({ id, result: { mode, reason, candidates } })
  } catch {
    parentPort.postMessage({ id, cancelled: true })
  }
})
