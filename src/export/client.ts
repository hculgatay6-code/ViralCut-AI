import type { ClipRange } from '../editor/model'
import type { Overlay, Transcript } from '../subtitles/model'
import type { Edit, Frame } from '../editor/shorts'
import type { Profile, Project, ProjectBridge, ProjectMedia } from '../project/model'
import { linkedFiles } from '../project/model'
import type { Candidate } from '../editor/autoShorts'
import type { StudioEffects } from '../editor/effects'
import type { CalendarEntry, Metadata, Platform, PlatformProfile, YouTubeChannel, YouTubeState } from '../editor/creatorMetadata'

export type ExportErrorCode =
  | 'badRequest' | 'badSource' | 'badRange' | 'busy' | 'diskFull' | 'encodeFailed'
  | 'toolsUnavailable' | 'uploadFailed' | 'jobMissing' | 'serviceError'
  | 'invalidName' | 'saveFailed' | 'accessDenied' | 'sourceProtected'
  | 'whisperUnavailable' | 'noAudio' | 'transcriptFailed' | 'badSubtitles' | 'tooManyCues'
  | 'badEdit' | 'emptyEdit' | 'layerConcurrency'
  | 'missingProjectMedia' | 'verifyFailed' | 'clipDecodeFailed' | 'visualDecodeFailed'

export interface ExportJob {
  id: string
  phase: 'waiting' | 'receiving' | 'processing' | 'ready' | 'failed'
  progress: number
  stage?: 'silence' | 'speech' | 'media' | 'ranking' | 'vision'
  cacheHit?: boolean
  proxyCount?: number
  waiting?: boolean
  error?: ExportErrorCode
  encoder?: 'CPU' | 'NVENC'
  verification?: { duration: number; width: number; height: number; fps: number; captions: boolean; audio: boolean }
}

export type AudioReport = { integrated: number | null; peak: number | null; range: number | null; duration: number; streamDeltaMs: number | null }

export type BatchRequest = { mediaId: string; language: 'tr' | 'en'; resolution: 720 | 1080; encoder: 'auto' | 'cpu';
  useMusic?: boolean;
  items: (ClipRange & { frame: Frame; remove: ClipRange[]; overlay?: Overlay; effects?: StudioEffects; edgeFade?: boolean;
    mastering?: { target: number; musicLevel: number } })[] }
export type BatchResult = { active: boolean; waiting?: boolean; items: ({ phase: 'queued' | 'processing' | 'ready' | 'failed' | 'cancelled'; progress: number;
  platform?: Platform;
  decoder?: string;
  error?: ExportErrorCode; filename?: string; encoder?: ExportJob['encoder']; verification?: ExportJob['verification'];
  warnings?: ('blackFrames' | 'quietOutput' | 'loudPeak' | 'loudnessDeviation' | 'longSilence' | 'fastCaptions')[];
  quality?: { integrated?: number | null; peak?: number | null; range?: number | null; avDeltaMs: number; blackSeconds: number; silentSeconds: number };
  retried?: boolean })[]; resources?: { memoryMiB: number; cpuSeconds: number } }
export type ShortsAnalysis = Transcript & { silences: ClipRange[]; truncated: boolean; hasAudio?: boolean; speechUnavailable?: boolean;
  duration?: number; width?: number; height?: number;
  visual?: { events: { time: number; cut: boolean; motion: number }[]; models: string[]; step: number; detectionStep: number; samples?: number; sceneCount?: number }; selection?: {
  mode: 'e5' | 'rules' | 'visual'; reason?: 'modelMissing' | 'modelIntegrity' | 'modelFailed' | 'noSpeech'; candidates: Candidate[]
} }

interface SaveHandle {
  name: string
  createWritable(): Promise<WritableStream<Uint8Array>>
}

interface FilePicker {
  (options: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
  }): Promise<SaveHandle>
}

declare global {
  interface Window {
    viralCutDesktop?: {
      saveClip(id: string, filename: string, language: string): Promise<{ filename?: string; cancelled?: boolean; error?: ExportErrorCode }>
      chooseModel(language: string): Promise<'ready' | 'cancelled' | 'invalid' | 'error'>
      registerSource(file: File): Promise<{ media?: ProjectMedia }>
      diagnostics(): Promise<{ entries?: import('../editor/Diagnostics').DiagnosticEntry[] }>
      exportDiagnostics(language: string): Promise<{ saved?: boolean; cancelled?: boolean; error?: string }>
      beta: {
        read(): Promise<{ settings?: import('../editor/BetaSettings').BetaPreferences; version?: string }>
        save(settings: import('../editor/BetaSettings').BetaPreferences): Promise<{ settings?: import('../editor/BetaSettings').BetaPreferences }>
        check(): Promise<import('../editor/BetaSettings').ReleaseCheck>
        open(target: 'repository' | 'issues' | 'releases'): Promise<{ opened?: boolean }>
      }
      performance: {
        read(): Promise<import('../editor/PerformanceCenter').PerformanceData>
        profile(value: string): Promise<void>
        clear(): Promise<{ cleared?: boolean }>
        clearPreviews(): Promise<{ cleared?: boolean }>
      }
      microphone(allow: boolean): Promise<{ allowed?: boolean }>
      creator: {
        profiles(): Promise<PlatformProfile[]>
        start(request: { language: 'tr' | 'en'; mediaId: string; items: (BatchRequest['items'][number] & { platform: Platform;
          metadata: Metadata; preset: { bitrate: number; fps: number; max: number } })[] }): Promise<BatchResult & { error?: string; cancelled?: boolean }>
        status(): Promise<BatchResult>
        cancel(): Promise<void>
        reveal(): Promise<void>
        calendar(): Promise<{ rows?: CalendarEntry[] }>
        save(row: Metadata & { id?: string; platform: Platform; plannedAt: string; output?: string }): Promise<{ row?: CalendarEntry; error?: string }>
        youtube: {
          account(): Promise<{ channel?: YouTubeChannel }>
          connect(): Promise<{ channel?: YouTubeChannel; error?: string }>
          disconnect(): Promise<{ error?: string }>
          start(data: Metadata & { filename: string; channel: string; language: 'tr' | 'en'; privacy: string; forKids: boolean;
            synthetic: boolean; publishAt?: string }): Promise<{ started?: boolean; cancelled?: boolean; error?: string }>
          status(): Promise<{ upload?: YouTubeState }>
          cancel(): Promise<void>
        }
      }
      effectsLibrary: {
        read(): Promise<import('../../server/effect-document.mjs').EffectsLibrary | undefined>
        save(value: import('../../server/effect-document.mjs').EffectsLibrary): Promise<boolean>
      }
      projects: ProjectBridge
      studio: {
        templates(): Promise<{ templates?: import('../subtitles/CaptionStudio').CaptionTemplate[] }>
        saveTemplate(item: import('../subtitles/CaptionStudio').CaptionTemplate): ReturnType<NonNullable<Window['viralCutDesktop']>['studio']['templates']>
        saveCover(image: { format: 'png' | 'jpg'; bytes: Uint8Array; language: 'tr' | 'en' }): Promise<{ saved?: boolean; cancelled?: boolean }>
      }
      shorts: {
        chooseSource(language: 'tr' | 'en'): Promise<{ media?: ProjectMedia; error?: string }>
        start(request: BatchRequest): Promise<BatchResult & { folder?: string; error?: ExportErrorCode; cancelled?: boolean }>
        status(): Promise<BatchResult>
        cancel(): Promise<BatchResult>
      }
      director: {
        music(language: 'tr' | 'en'): Promise<{ name?: string; error?: string }>
        folder(language: 'tr' | 'en'): Promise<{ cancelled?: boolean; error?: ExportErrorCode }>
        start(request: BatchRequest): Promise<BatchResult & { folder?: string; projectFiles?: string[]; error?: ExportErrorCode }>
        reveal(file: string): Promise<{ opened?: boolean }>
        project(index: number): Promise<{ project?: Project; error?: string }>
        status(): Promise<BatchResult>
        cancel(): Promise<void>
      }
    }
  }
}

const base = '/api/export'
const headers = { 'X-ViralCut': '2' }
const fileRoute = (id: string) => base + '/' + id + '/file'

export class ExportClientError extends Error {
  constructor(readonly code: ExportErrorCode) { super(code) }
}

export function normalizeFilename(name: string) {
  const trimmed = name.trim().replace(/\.mp4$/i, '')
  // oxlint-disable-next-line no-control-regex -- Reject Windows filename control characters.
  if (!trimmed || trimmed.length > 150 || /[<>:"/\\|?*\u0000-\u001f]|[. ]$/.test(trimmed) ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(trimmed)) return null
  return trimmed + '.mp4'
}

async function request<T>(path = '', options?: RequestInit): Promise<T> {
  const response = await fetch(base + path, {
    ...options, headers: { ...headers, ...options?.headers }, cache: 'no-store',
  })
  if (!response.headers.get('Content-Type')?.startsWith('application/json')) {
    throw new ExportClientError('serviceError')
  }
  const data = await response.json()
  if (!response.ok) throw new ExportClientError(data.error || 'serviceError')
  return data
}

function upload(id: string, file: File, signal: AbortSignal, onProgress: (value: number) => void) {
  signal.throwIfAborted()
  if (linkedFiles.has(file)) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    xhr.open('PUT', base + '/' + id + '/input')
    xhr.setRequestHeader('X-ViralCut', '2')
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.responseType = 'json'
    xhr.upload.onprogress = event => onProgress(event.loaded / file.size * 100)
    xhr.onload = () => {
      if (xhr.status === 202) resolve()
      else reject(new ExportClientError(xhr.response?.error ?? 'uploadFailed'))
    }
    xhr.onerror = () => reject(new ExportClientError('uploadFailed'))
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    xhr.onloadend = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    xhr.send(file)
  })
}

export const localExporter = {
  async available(signal: AbortSignal) {
    const result = await request<{ available: boolean }>('', { signal })
    return result.available
  },
  create(file: File, range: ClipRange, overlay?: Overlay, edit?: Edit, profile?: Profile, effects?: StudioEffects, monitor = false) {
    return request<ExportJob>('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...range, overlay, edit, profile, effects, monitor, ...fileSettings(file) }),
    })
  },
  upload,
  monitorUrl(id: string) { return base + '/' + id + '/monitor' },
  createLayers(project: Project, preview?: { from: number; to: number; proxy?: import('../project/model').ProxyResolution }) {
    return request<ExportJob>('', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'sequence', timeline: project.timeline, frame: project.frame,
        profile: { ...project.profile, fps: project.timeline?.fps }, appearance: project.appearance,
        encoder: project.encoder, burn: project.burn, preview }),
    })
  },
  createSequence(project: Project, monitor = false) {
    const media = new Map(project.media.map(item => [item.id, item]))
    return request<ExportJob>('', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'sequence', frame: project.frame, profile: project.profile, monitor, mastering: project.mastering,
        appearance: project.appearance, encoder: project.encoder, clips: project.clips.map(clip => ({
          ...clip, cues: project.burn ? media.get(clip.mediaId)?.cues.filter(cue =>
            cue.text.trim() && cue.start < clip.end && cue.end > clip.start) : undefined,
        })) }),
    })
  },
  createSilence(file: File, threshold: number, minimum: number, automatic: boolean) {
    return request<ExportJob>('', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fileSettings(file), kind: 'silence', automatic, analysis: { threshold, minimum } }),
    })
  },
  silences(id: string, signal: AbortSignal) {
    return request<{ silences: ClipRange[]; truncated: boolean }>('/' + id + '/silence', { signal })
  },
  analyzeAudio(mediaId: string, range: ClipRange) {
    return request<ExportJob>('', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'audio-analysis', mediaId, ...range }) })
  },
  audioReport(id: string, signal: AbortSignal) { return request<AudioReport>('/' + id + '/audio', { signal }) },
  whisper(signal: AbortSignal) {
    return request<{ available: boolean; modelPresent: boolean; enginePresent: boolean; mediaAvailable: boolean }>('/whisper', { signal })
  },
  createTranscript(file: File, language: 'auto' | 'tr' | 'en', device: 'auto' | 'cpu', voice = false) {
    return request<ExportJob>('', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fileSettings(file), kind: 'transcribe', language, device, voice }),
    })
  },
  analyzeShorts(mediaId: string, language: 'auto' | 'tr' | 'en', threshold: number, minimum: number, goal: number, duration: number,
    visualMode: 'general' | 'gaming', visualDevice: 'auto' | 'cpu', director = false) {
    return request<ExportJob>('', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'shorts-analysis', mediaId, language, device: 'auto', goal, duration, visualMode, visualDevice, director, analysis: { threshold, minimum } }) })
  },
  shortsAnalysis(id: string, signal: AbortSignal) { return request<ShortsAnalysis>('/' + id + '/transcript', { signal }) },
  transcript(id: string, signal: AbortSignal) { return request<Transcript>('/' + id + '/transcript', { signal }) },
  status(id: string, signal: AbortSignal) { return request<ExportJob>('/' + id, { signal }) },
  async release(id: string) {
    await request('/' + id, { method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(15000) }).catch(() => {})
  },
  async save(id: string, filename: string, signal: AbortSignal) {
    if (window.viralCutDesktop) {
      const saved = await window.viralCutDesktop.saveClip(id, filename, document.documentElement.lang)
      signal.throwIfAborted()
      if (saved.cancelled) throw new DOMException('Aborted', 'AbortError')
      if (saved.error || !saved.filename) throw new ExportClientError(saved.error ?? 'saveFailed')
      return { filename: saved.filename, confirmed: true }
    }
    const picker = (window as Window & { showSaveFilePicker?: FilePicker }).showSaveFilePicker
    if (!picker) {
      const link = document.createElement('a')
      link.href = base + '/' + id + '/download'
      link.download = filename
      document.body.append(link)
      link.click()
      link.remove()
      return { filename, confirmed: false }
    }

    const handle = await picker.call(window, {
      suggestedName: filename,
      types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
    })
    signal.throwIfAborted()
    const response = await fetch(fileRoute(id), { headers, signal })
    if (response.status === 404) throw new ExportClientError('jobMissing')
    if (!response.ok || !response.body) throw new ExportClientError('saveFailed')
    let writable
    try {
      writable = await handle.createWritable()
    } catch (error) {
      await response.body.cancel().catch(() => {})
      throw error
    }
    await response.body.pipeTo(writable, { signal })
    return { filename: handle.name, confirmed: true }
  },
}

function fileSettings(file: File) {
  const media = linkedFiles.get(file)
  if (media) return { mediaId: media.id }
  return { format: file.name.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4', size: file.size }
}
