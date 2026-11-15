export async function recordCommand(signal: AbortSignal, onReady: (stop: () => void) => void) {
  const bridge = window.viralCutDesktop
  if (!bridge || !navigator.mediaDevices || !MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) throw Error('microphone')
  if (!(await bridge.microphone(true)).allowed) throw Error('microphone')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  } finally { void bridge.microphone(false).catch(() => {}) }
  try {
    signal.throwIfAborted()
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 48000 })
    return await new Promise<File>((resolve, reject) => {
      const chunks: Blob[] = []
      const stop = () => { if (recorder.state !== 'inactive') recorder.stop() }
      const timer = setTimeout(stop, 15000)
      const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', stop) }
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recorder.onerror = () => { clean(); reject(Error('microphone')) }
      recorder.onstop = () => {
        clean()
        if (signal.aborted) reject(signal.reason)
        else if (!chunks.length) reject(Error('microphone'))
        else resolve(new File(chunks, 'copilot-voice.webm', { type: 'audio/webm' }))
      }
      signal.addEventListener('abort', stop, { once: true })
      try { recorder.start(250); onReady(stop) } catch (error) { clean(); reject(error) }
    })
  } finally { stream.getTracks().forEach(track => track.stop()) }
}
