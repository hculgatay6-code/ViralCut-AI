import type { ClipRange } from '../editor/model'
import type { Frame } from '../editor/shorts'
import type { Appearance, Cue } from '../subtitles/model'
import type { StudioEffects, StudioTransition } from '../editor/effects'

import type { LayerTimeline } from './layer-model'

export interface Profile { resolution: 720 | 1080; fps: 24 | 25 | 30 | 50 | 60; quality: 'quality' | 'balanced' | 'small'; bitrate: number }
export const defaultProfile: Profile = { resolution: 1080, fps: 30, quality: 'balanced', bitrate: 0 }
export interface ProjectMedia { id: string; name: string; size: number; missing: boolean; audioOnly?: boolean; cues: Cue[] }
export interface ProjectClip extends ClipRange { id: string; mediaId: string; muteAudio?: boolean; effects?: StudioEffects; transition?: StudioTransition }
export interface Project {
  version: 1 | 2 | 3 | 4
  timeline?: LayerTimeline
  media: ProjectMedia[]
  clips: ProjectClip[]
  appearance: Appearance
  frame?: Frame
  profile: Profile
  encoder: 'auto' | 'cpu'
  burn: boolean
  mastering?: { target: number; musicLevel: number }
}
export interface ProjectBridge {
  onClose(callback: () => void): () => void
  confirmClose(): Promise<void>
  addAudio(): Promise<{ media?: ProjectMedia; cancelled?: boolean; error?: string }>
  addMedia(): Promise<{ media?: ProjectMedia[]; rejected?: number; cancelled?: boolean; error?: string }>
  relink(id: string): Promise<{ media?: ProjectMedia; cancelled?: boolean; error?: string }>
  open(): Promise<{ project?: Project; cancelled?: boolean; error?: string }>
  save(project: Project): Promise<{ filename?: string; cancelled?: boolean; error?: string }>
  autosave(project: Project): Promise<{ saved?: boolean; error?: string; disabled?: boolean }>
  hasRecovery(): Promise<{ available?: boolean; damaged?: boolean; fallback?: boolean }>
  recover(): Promise<{ project?: Project; error?: string }>
  prepare(id: string, type: PreviewKind, height?: ProxyResolution, device?: 'auto' | 'cpu'): Promise<PreviewResult>
  previewStatus(id: string, type: PreviewKind, height?: ProxyResolution): Promise<PreviewResult>
  cancelPreview(id: string, type: PreviewKind, height?: ProxyResolution): Promise<PreviewResult>
}

export type PreviewKind = 'proxy' | 'waveform'
export type ProxyResolution = 360 | 540 | 720
export type PreviewResult = {
  phase?: 'idle' | 'queued' | 'running' | 'ready' | 'failed' | 'cancelled'; progress?: number; peaks?: number[]; step?: number; error?: string
  width?: number; height?: number; resolution?: ProxyResolution; cached?: boolean; encoder?: string; decoder?: string
}
export type Waveform = { peaks: number[]; step: number }

export interface History { previous: Project[]; present: Project; next: Project[] }
export type ProjectAction =
  | { type: 'update'; apply: (project: Project) => Project }
  | { type: 'load'; state: Project }
  | { type: 'undo' | 'redo' }

export function historyReducer(history: History, action: ProjectAction): History {
  if (action.type === 'load') return { present: action.state, previous: [], next: [] }
  if (action.type === 'undo') {
    const present = history.previous.at(-1)
    return present ? { previous: history.previous.slice(0, -1), present, next: [history.present, ...history.next] } : history
  }
  if (action.type === 'redo') {
    const [present, ...next] = history.next
    return present ? { previous: [...history.previous, history.present], present, next } : history
  }
  if (action.type !== 'update') return history
  const present = action.apply(history.present)
  return present === history.present ? history : {
    previous: [...history.previous.slice(-39), history.present], present, next: [],
  }
}

export function moveClip(clips: ProjectClip[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= clips.length || to >= clips.length || from === to) return clips
  const next = [...clips]
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

export function subtractSpeech(clips: ProjectClip[], mediaId: string, ranges: ClipRange[]) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  return clips.flatMap(clip => {
    if (clip.mediaId !== mediaId) return [clip]
    let cursor = clip.start
    const keep: ClipRange[] = []
    for (const range of sorted) {
      if (range.end <= cursor || range.start >= clip.end) continue
      if (range.start - cursor >= 0.001) keep.push({ start: cursor, end: range.start })
      cursor = Math.min(clip.end, Math.max(cursor, range.end))
    }
    if (clip.end - cursor >= 0.001) keep.push({ start: cursor, end: clip.end })
    if (keep.length === 1 && keep[0].start === clip.start && keep[0].end === clip.end) return [clip]
    return keep.map((segment, index) => ({ ...clip, ...segment, id: index ? crypto.randomUUID() : clip.id,
      transition: index === keep.length - 1 ? clip.transition : undefined }))
  })
}

export const linkedFiles = new WeakMap<File, ProjectMedia>()

export function timelineLayout(clips: ProjectClip[], media: ProjectMedia[], fps = 30) {
  const sources = new Map(media.map(entry => [entry.id, entry]))
  let offset = 0
  return clips.map((clip, index) => {
    const length = clip.end - clip.start
    const start = offset
    offset += length
    const next = clips[index + 1]
    const overlap = clip.transition && next ? Math.min(Math.round(clip.transition.duration * fps),
      Math.floor(Math.round(length * fps) / 2), Math.floor(Math.round((next.end - next.start) * fps) / 2)) / fps : 0
    const source = sources.get(clip.mediaId)
    const captions = (source?.cues ?? []).flatMap(cue => {
      const from = Math.max(clip.start, cue.start)
      const to = Math.min(clip.end, cue.end)
      return to > from && cue.text.trim() ? [{ text: cue.text, from: start + from - clip.start, to: start + to - clip.start }] : []
    })
    const end = offset
    offset -= overlap
    return { clip, source, start, end, length, captions, overlap }
  })
}
