import { freemem, totalmem } from 'node:os'
import { statfs, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inputOptions, run } from '../server/media.mjs'

const mib = 1048576
const number = value => value?.trim() && Number.isFinite(Number(value)) ? Number(value) : null

export function createPerformanceMonitor(app) {
  const cancel = new AbortController()
  let previous, captured, gpuPending
  let hardware = { status: 'checking', decode: [], nvenc: false, scaleCuda: false, providers: [] }
  async function probe() {
    const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(35000)])
    const directory = await mkdtemp(join(tmpdir(), 'viralcut-probe-'))
    try {
      const input = join(directory, 'check.mp4')
      let hasNvenc = false
      const [build] = await Promise.all([
        run('ffmpeg', ['-hide_banner', '-hwaccels'], signal),
        run('ffmpeg', ['-hide_banner', '-encoders'], signal, line => { if (/\bh264_nvenc\s/.test(line)) hasNvenc = true }),
      ])
      await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x384:d=0.2:r=25',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input], signal)
      const check = async (prefix, args) => {
        try {
          await run('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', ...prefix, ...inputOptions('mp4'), '-i', input,
            '-frames:v', '3', ...args, '-f', 'null', '-'], signal)
          return true
        } catch { return false }
      }
      const decode = []
      for (const api of ['cuda', 'd3d11va', 'dxva2']) if (build.split(/\s+/).includes(api) &&
          await check(['-hwaccel', api], ['-vf', 'scale=64:64'])) decode.push(api)
      const nvenc = hasNvenc && await check([], ['-c:v', 'h264_nvenc'])
      const scaleCuda = decode.includes('cuda') && nvenc && await check(
        ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'], ['-vf', 'scale_cuda=480:288', '-c:v', 'h264_nvenc'])
      hardware = { status: 'ready', decode, nvenc, scaleCuda, providers: hardware.providers }
    } finally { await rm(directory, { recursive: true, force: true, maxRetries: 3 }) }
  }
  const probeWork = probe().catch(() => { hardware.status = 'unavailable' })
  return {
    providers(values) { hardware.providers = [...new Set(values.filter(value => ['cpu', 'dml', 'cuda'].includes(value)))] },
    decode: () => hardware.decode.includes('cuda') ? 'cuda' : hardware.decode[0],
    async sample() {
      const time = Date.now()
      if (!previous || time - previous >= 2400) {
        previous = time
        gpuPending = (async () => {
          const root = process.env.SystemRoot
          const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(1200)])
          const query = ['--query-gpu=utilization.gpu,utilization.encoder,utilization.decoder,memory.used,memory.total', '--format=csv,noheader,nounits']
          for (const executable of [root && join(root, 'System32', 'nvidia-smi.exe'), process.env.ProgramFiles &&
            join(process.env.ProgramFiles, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')].filter(Boolean)) {
            try {
              const [gpu, encode, decode, vram, vramTotal] = (await run(executable, query, signal)).split(/\r?\n/)[0].split(',').map(number)
              return { gpu, encode, decode, vram, vramTotal }
            } catch { /* GPU metrics can be unavailable. */ }
          }
          return null
        })()
      }
      captured = await gpuPending
      const metrics = app.getAppMetrics()
      const sum = (rows, select) => rows.reduce((n, row) => n + select(row), 0)
      const ram = rows => Math.round(sum(rows, row => row.memory.workingSetSize) / 1024)
      const disk = await statfs(tmpdir()).then(info => Math.round(info.bavail * info.bsize / mib), () => null)
      return { cpu: Math.round(sum(metrics, row => row.cpu.percentCPUUsage) * 10) / 10,
        ram: ram(metrics), main: ram(metrics.filter(row => row.type === 'Browser')),
        renderer: ram(metrics.filter(row => row.type === 'Tab')), usedMiB: Math.round((totalmem() - freemem()) / mib),
        disk, gpu: captured, hardware }
    },
    async close() { cancel.abort(); await Promise.allSettled([probeWork, gpuPending]) },
  }
}
