import { AsyncLocalStorage } from 'node:async_hooks'
import { availableParallelism, freemem, totalmem } from 'node:os'
import { setTimeout } from 'node:timers/promises'

const workerBudget = new AsyncLocalStorage()
export const ffmpegThreads = fallback => String(Math.min(fallback, workerBudget.getStore()?.threads ?? fallback))
export const fastDecode = () => workerBudget.getStore()?.decode
export const profileNames = ['eco', 'balanced', 'performance']

export function createResourceBudget({ free = freemem, total = totalmem, cores = availableParallelism, poll = 800 } = {}) {
  let profile = 'balanced', active, waiting = 0
  const mib = 1048576
  function memory() {
    const capacity = total()
    const available = free()
    return { available, capacity, pressure: available < Math.min(1152 * mib, Math.max(600 * mib, capacity * .10)) }
  }
  return {
    change(value) { if (profileNames.includes(value)) profile = value },
    info() {
      const { available, capacity, pressure } = memory()
      return { profile, active, waiting, pressure, availableMiB: Math.round(available / mib), totalMiB: Math.round(capacity / mib) }
    },
    async work(label, signal, run, { wait, decode, trim } = {}) {
      signal.throwIfAborted()
      waiting++
      try {
        while (active || memory().pressure) {
          wait?.()
          if (!active) await trim?.()
          await setTimeout(poll, undefined, { signal })
        }
        active = label
      } finally { waiting-- }
      try {
        const { available, capacity } = memory()
        const roomy = available > Math.max(2400 * mib, capacity * .20)
        const threads = Math.max(1, Math.min(cores(), profile === 'eco' || !roomy ? 2 : 4))
        if (profile === 'eco' || !roomy) await trim?.()
        return await workerBudget.run({ threads, decode: profile === 'performance' && roomy ? decode : undefined }, run)
      } finally { active = undefined }
    },
  }
}
