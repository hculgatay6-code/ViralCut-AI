import { useEffect, useRef, useState } from 'react'
import type { ClipRange, VideoMetadata } from './model'
import { clamp } from './model'
import type { Copy } from '../i18n'
import type { ProjectMedia } from '../project/model'
import { linkedFiles } from '../project/model'

type MediaErrorKey = Extract<keyof Copy, 'unsupported' | 'emptyFile' | 'multiple' | 'decode' | 'playFailed' | 'invalidRange' | 'invalidTime'>
interface Source {
  file: File
  url: string
  revision: number
}

export function useVideo() {
  const element = useRef<HTMLVideoElement>(null)
  const activeUrl = useRef<string>(null)
  const revision = useRef(0)
  const [source, setSource] = useState<Source | null>(null)
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [range, setRange] = useState<ClipRange>({ start: 0, end: 0 })
  const [error, setError] = useState<MediaErrorKey | null>(null)

  useEffect(() => () => {
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current)
  }, [])

  function clearSource() {
    revision.current++
    element.current?.pause()
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current)
    activeUrl.current = null
    setSource(null)
    setMetadata(null)
    setPlaying(false)
    setTime(0)
    setRange({ start: 0, end: 0 })
  }

  async function open(files: FileList | null) {
    if (!files?.length) return
    if (files.length > 1) return setError('multiple')
    const file = files[0]
    if (!/\.(mp4|webm)$/i.test(file.name)) return setError('unsupported')
    if (file.size === 0) return setError('emptyFile')

    clearSource()
    const request = revision.current
    if (window.viralCutDesktop) {
      try {
        const result = await window.viralCutDesktop.registerSource(file)
        if (request !== revision.current) return
        if (result.media) return openLinked(result.media)
      } catch { if (request !== revision.current) return }
      return setError('decode')
    }
    const url = URL.createObjectURL(file)
    activeUrl.current = url
    setSource({ file, url, revision: request })
    setError(null)
  }

  function openLinked(media: ProjectMedia) {
    if (media.missing) return
    clearSource()
    // Metadata stand-in. The video element streams the original and jobs resolve the registered ID.
    const file = new File([], media.name)
    linkedFiles.set(file, media)
    setSource({ file, url: '/project-media/' + media.id, revision: revision.current })
    setError(null)
  }

  function fail(video: HTMLVideoElement) {
    if (element.current !== video) return
    clearSource()
    setError('decode')
  }

  function readMetadata(video: HTMLVideoElement) {
    if (element.current !== video) return
    const { duration, videoWidth: width, videoHeight: height } = video
    if (!Number.isFinite(duration) || duration <= 0 || !width || !height) {
      fail(video)
      return
    }
    setMetadata({ duration, width, height })
    setRange({ start: 0, end: duration })
  }

  function seek(seconds: number) {
    const video = element.current
    if (!video || !metadata || !Number.isFinite(seconds)) return
    video.currentTime = clamp(seconds, 0, metadata.duration)
    setTime(video.currentTime)
  }

  async function togglePlayback() {
    const video = element.current
    if (!video || !metadata) return
    if (!video.paused) {
      video.pause()
      return
    }
    if (video.ended) seek(0)
    try {
      await video.play()
    } catch (reason) {
      if (element.current === video && !(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError('playFailed')
      }
    }
  }

  function setBoundary(boundary: keyof ClipRange, seconds: number, drag = false) {
    if (!metadata) return
    if (!Number.isFinite(seconds)) return setError('invalidTime')
    const next = { ...range, [boundary]: seconds }
    if (drag) {
      const gap = Math.min(0.001, metadata.duration)
      next[boundary] = boundary === 'start'
        ? clamp(seconds, 0, Math.max(0, range.end - gap))
        : clamp(seconds, Math.min(metadata.duration, range.start + gap), metadata.duration)
    }
    if (next.start < 0 || next.end > metadata.duration || next.start >= next.end) {
      setError('invalidRange')
      return
    }
    setRange(next)
    setError(null)
  }

  function resetRange() {
    if (!metadata) return
    setRange({ start: 0, end: metadata.duration })
    setError(null)
  }

  function selectRange(next: ClipRange) {
    if (!metadata || next.start < 0 || next.end > metadata.duration || next.end <= next.start) return
    setRange(next)
    setError(null)
  }

  return {
    element, source, metadata, time, playing, muted, range, error,
    open, openLinked, clearSource, fail, readMetadata, seek, togglePlayback, setBoundary, resetRange, selectRange,
    setTime, setPlaying, setMuted, setError,
  }
}

export type VideoEditor = ReturnType<typeof useVideo>
