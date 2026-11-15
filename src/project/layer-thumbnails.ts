import { useCallback, useEffect, useRef } from 'react'

const maxEntries = 48
type Work = { mediaId: string; url: string; time: number; image: HTMLImageElement; key: string }

function awaitMedia(video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked' | 'loadeddata', signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer)
      video.removeEventListener(event, loaded)
      video.removeEventListener('error', failed)
      signal.removeEventListener('abort', failed)
    }
    function loaded() { cleanup(); resolve() }
    function failed() { cleanup(); reject(Error('thumbnail')) }
    const timer = window.setTimeout(failed, 5000)
    video.addEventListener(event, loaded, { once: true })
    video.addEventListener('error', failed, { once: true })
    signal.addEventListener('abort', failed, { once: true })
  })
}

export function useLayerThumbnails(scroll: React.RefObject<HTMLDivElement | null>, media: unknown) {
  const observer = useRef<IntersectionObserver | null>(null)
  const refs = useRef(new Set<HTMLImageElement>())
  useEffect(() => {
    if (!scroll.current) return
    const controller = new AbortController()
    const video = document.createElement('video')
    video.muted = true; video.preload = 'auto'
    const canvas = document.createElement('canvas')
    canvas.width = 96; canvas.height = 54
    const context = canvas.getContext('2d', { alpha: false })
    const cache = new Map<string, string>()
    const pending = new Map<HTMLImageElement, Work>()
    let running = false

    async function drain() {
      if (running || controller.signal.aborted || !context) return
      running = true
      try {
        while (pending.size && !controller.signal.aborted) {
          const task = pending.values().next().value!
          pending.delete(task.image)
          if (!task.image.isConnected) continue
          const cached = cache.get(task.key)
          if (cached) { task.image.src = cached; continue }
          try {
            if (video.getAttribute('src') !== task.url || video.readyState < 1) {
              const loading = awaitMedia(video, 'loadedmetadata', controller.signal)
              video.src = task.url
              await loading
            }
            const target = Math.max(0, Math.min(video.duration - 0.04, task.time))
            if (Math.abs(video.currentTime - target) > .001) {
              const seeking = awaitMedia(video, 'seeked', controller.signal)
              video.currentTime = target
              await seeking
            }
            if (video.readyState < 2) await awaitMedia(video, 'loadeddata', controller.signal)
            if (!video.videoWidth || !video.videoHeight || controller.signal.aborted) continue
            const scale = Math.max(96 / video.videoWidth, 54 / video.videoHeight)
            context.drawImage(video, (96 - scale * video.videoWidth) / 2, (54 - scale * video.videoHeight) / 2,
              scale * video.videoWidth, scale * video.videoHeight)
            const image = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .72))
            if (!image || controller.signal.aborted) continue
            const url = URL.createObjectURL(image)
            cache.set(task.key, url)
            if (cache.size > maxEntries) {
              const key = cache.keys().next().value!
              URL.revokeObjectURL(cache.get(key)!)
              cache.delete(key)
            }
            if (task.image.isConnected) task.image.src = url
          } catch { /* A failed thumbnail leaves the timeline label available. */ }
        }
      } finally {
        running = false
        video.removeAttribute('src'); video.load()
      }
    }

    observer.current = new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        if (!(target instanceof HTMLImageElement)) continue
        if (!isIntersecting) { pending.delete(target); continue }
        const mediaId = target.dataset.source
        const time = Number(target.dataset.time)
        if (!mediaId || !Number.isFinite(time)) continue
        const key = mediaId + '/' + time
        pending.set(target, { mediaId, time, image: target, key, url: '/project-media/' + mediaId })
      }
      void drain()
    }, { root: scroll.current })
    refs.current.forEach(image => { image.removeAttribute('src'); observer.current?.observe(image) })
    return () => {
      controller.abort()
      observer.current?.disconnect()
      observer.current = null
      for (const url of cache.values()) URL.revokeObjectURL(url)
      video.removeAttribute('src'); video.load()
    }
  }, [scroll, media])

  return useCallback((image: HTMLImageElement | null) => {
    if (!image) return
    refs.current.add(image)
    observer.current?.observe(image)
    return () => {
      observer.current?.unobserve(image)
      refs.current.delete(image)
    }
  }, [])
}
