import { useEffect, useRef, useState } from 'react'
import type { Language } from '../i18n'
import type { Cue } from '../subtitles/model'
import { timecode } from './model'
import type { ClipRange } from './model'

const fonts = ['Arial', 'Segoe UI', 'Verdana']

function drawCover(canvas: HTMLCanvasElement, frame: HTMLCanvasElement, landscape: boolean, title: string,
  font: string, size: number, color: string, y: number, blur: number, brightness: number, contrast: number) {
  const width = landscape ? 1920 : 1080
  const height = landscape ? 1080 : 1920
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return false
  const painter = context
  function draw(scale: number) {
    const w = frame.width * scale, h = frame.height * scale
    painter.drawImage(frame, (width - w) / 2, (height - h) / 2, w, h)
  }
  const colors = `brightness(${brightness}%) contrast(${contrast}%)`
  const cover = Math.max(width / frame.width, height / frame.height)
  context.fillStyle = '#101010'; context.fillRect(0, 0, width, height)
  context.filter = blur ? `${colors} blur(${blur}px)` : colors
  draw(blur ? cover * 1.09 : cover)
  if (blur) { context.filter = colors; draw(Math.min(width / frame.width, height / frame.height)) }
  context.filter = 'none'
  context.font = `bold ${size}px "${font}"`
  context.textAlign = 'center'; context.textBaseline = 'middle'
  context.strokeStyle = '#151515'; context.lineJoin = 'round'; context.lineWidth = size / 10
  context.fillStyle = color
  const lines: string[] = []
  let line = ''
  for (const word of title.trim().split(/\s+/u)) {
    const next = line ? `${line} ${word}` : word
    if (line && context.measureText(next).width > .82 * width) { lines.push(line); line = word }
    else line = next
  }
  if (line) lines.push(line)
  if (lines.length > 5) return false
  const middle = Math.max((lines.length / 2 + .5) * size, Math.min(height - (lines.length / 2 + .5) * size, y * height / 100))
  lines.forEach((text, index) => {
    const baseline = middle + (index - (lines.length - 1) / 2) * size * 1.15
    context.strokeText(text, width / 2, baseline, .82 * width)
    context.fillText(text, width / 2, baseline, .82 * width)
  })
  return true
}

export function CoverStudio({ language, source, range, cues, initialTitle }: { language: Language; source: string; range: ClipRange; cues: Cue[]; initialTitle?: string }) {
  const tr = language === 'tr'
  const bridge = window.viralCutDesktop?.studio
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const frame = useRef<HTMLCanvasElement | null>(null)
  const [revision, setRevision] = useState(0)
  const [frameTime, setFrameTime] = useState(initialTitle ? range.start + (range.end - range.start) * .15 : range.start)
  const [status, setStatus] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [landscape, setLandscape] = useState(false)
  const [title, setTitle] = useState(initialTitle?.slice(0, 100) ?? '')
  const [font, setFont] = useState(fonts[0])
  const [size, setSize] = useState(90)
  const [color, setColor] = useState('#ffffff')
  const [y, setY] = useState(74)
  const [blur, setBlur] = useState(0)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [fits, setFits] = useState(true)
  const clipEnd = Math.max(range.start, range.end - .05)
  const candidates = [.15, .5, .82].map(ratio => range.start + (clipEnd - range.start) * ratio)
  const titles = [...new Set(cues.filter(cue => cue.start < range.end && cue.end > range.start).slice(0, 60)
    .map(cue => cue.text.trim().replace(/\s+/gu, ' ')).filter(text => text.length >= 12 && text.length <= 85))].slice(0, 4)

  useEffect(() => {
    if (frame.current && canvas.current) setFits(drawCover(canvas.current, frame.current, landscape, title, font, size, color, y, blur, brightness, contrast))
  }, [revision, landscape, title, font, size, color, y, blur, brightness, contrast])

  useEffect(() => {
    const element = video.current
    if (!element) return
    const cancel = new AbortController()
    const signal = cancel.signal
    function failed() {
      frame.current = null
      setRevision(0); setStatus('frame'); setCapturing(false)
    }
    function capture() {
      if (!element || element.readyState < 2 || element.seeking || !element.videoWidth) return
      const target = Math.max(0, Math.min(element.duration - .04, frameTime))
      if (Math.abs(element.currentTime - target) > .035) { element.currentTime = target; return }
      window.clearTimeout(timeout)
      const bitmap = frame.current ?? document.createElement('canvas')
      const scale = Math.min(1, 1920 / Math.max(element.videoWidth, element.videoHeight))
      bitmap.width = Math.max(1, Math.round(element.videoWidth * scale))
      bitmap.height = Math.max(1, Math.round(element.videoHeight * scale))
      bitmap.getContext('2d')?.drawImage(element, 0, 0, bitmap.width, bitmap.height)
      frame.current = bitmap
      setRevision(value => value + 1); setCapturing(false)
    }
    setStatus(''); setCapturing(true)
    const timeout = window.setTimeout(failed, 12000)
    element.addEventListener('loadeddata', capture, { signal })
    element.addEventListener('seeked', capture, { signal })
    element.addEventListener('error', failed, { signal })
    if (element.error) failed()
    else capture()
    return () => { cancel.abort(); window.clearTimeout(timeout) }
  }, [frameTime, source])

  async function save(format: 'png' | 'jpg') {
    if (!bridge || !canvas.current || !fits || saving || capturing) return
    setSaving(true); setStatus('')
    try {
      const image = await new Promise<Blob | null>(resolve => canvas.current?.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', .92))
      if (!image) throw new Error()
      const result = await bridge.saveCover({ format, bytes: new Uint8Array(await image.arrayBuffer()), language })
      if (result.saved) setStatus('saved')
      else if (!result.cancelled) setStatus('save')
    } catch { setStatus('save') }
    finally { setSaving(false) }
  }

  return <section className="cover-studio">
    <video className="cover-source" ref={video} src={source} preload="auto" muted playsInline aria-hidden="true" />
    <div className="cover-preview"><canvas ref={canvas} hidden={!revision} aria-label={tr ? 'Kapak önizlemesi' : 'Cover preview'} /></div>
    {capturing && <p role="status">{tr ? 'Video karesi okunuyor…' : 'Reading video frame…'}</p>}
    <fieldset disabled={saving} className="studio-design-controls">
      {initialTitle !== undefined && <label>{tr ? 'Kapak stili' : 'Cover style'}<select defaultValue="" onChange={event => {
        const styles = [
          ['#ffef65', 105, 70, 0, 117], ['#ffffff', 84, 73, 16, 104], ['#ffe5c6', 89, 71, 9, 114],
          ['#ffffff', 70, 75, 0, 98], ['#ffdfe8', 108, 64, 7, 108], ['#d9ffdf', 79, 78, 12, 108],
        ] as const
        const [text, fontSize, position, background, contrast] = styles[Number(event.target.value)]
        setColor(text); setSize(fontSize); setY(position); setBlur(background); setContrast(contrast)
      }}><option value="" disabled>{tr ? 'Stil seç' : 'Choose style'}</option>
        {(tr ? ['Oyun', 'Podcast', 'Sinematik', 'Minimal', 'Eğlence', 'Eğitim'] : ['Gaming', 'Podcast', 'Cinematic', 'Minimal', 'Fun', 'Education'])
          .map((label, i) => <option key={i} value={i}>{label}</option>)}</select></label>}
      <div className="shorts-actions caption-grid-wide">{candidates.map((seconds, index) => <button type="button" key={index} className="export-cancel" aria-pressed={Math.abs(frameTime - seconds) < .03} onClick={() => setFrameTime(seconds)}>{timecode(seconds)}</button>)}</div>
      <label className="caption-grid-wide">{tr ? 'Video karesi' : 'Video frame'} · {timecode(frameTime)}<input type="range" min={range.start} max={clipEnd} step=".01" value={frameTime} onChange={event => setFrameTime(event.target.valueAsNumber)} /></label>
      <label>{tr ? 'Kapak oranı' : 'Cover format'}<select value={landscape ? 'landscape' : 'portrait'} onChange={event => setLandscape(event.target.value === 'landscape')}><option value="portrait">9:16</option><option value="landscape">16:9</option></select></label>
      <label>{tr ? 'Yazı tipi' : 'Typeface'}<select value={font} onChange={event => setFont(event.target.value)}>{fonts.map(item => <option key={item}>{item}</option>)}</select></label>
      {!!titles.length && <label className="caption-grid-wide">{tr ? 'Konuşmadan alıntı' : 'Quote from transcript'}<select value="" onChange={event => setTitle(event.target.value)}><option value="">{tr ? 'Başlık önerisi seç' : 'Choose a suggested title'}</option>{titles.map(item => <option key={item}>{item}</option>)}</select></label>}
      <label className="caption-grid-wide">{tr ? 'Kapak başlığı' : 'Cover title'}<textarea maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>{tr ? 'Yazı rengi' : 'Text color'}<input type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
      {[
        [tr ? 'Boyut' : 'Size', 40, 160, size, setSize], [tr ? 'Dikey konum' : 'Vertical position', 12, 88, y, setY],
        [tr ? 'Arka plan bulanıklığı' : 'Background blur', 0, 36, blur, setBlur], [tr ? 'Parlaklık' : 'Brightness', 65, 140, brightness, setBrightness],
        [tr ? 'Kontrast' : 'Contrast', 65, 145, contrast, setContrast],
      ].map(([label, min, max, value, set]) => <label key={String(label)}>{String(label)}<input type="range" min={Number(min)} max={Number(max)} value={Number(value)} onChange={event => { if (typeof set === 'function') set(event.target.valueAsNumber) }} /></label>)}
    </fieldset>
    {!fits && <p role="alert">{tr ? 'Başlığı kısaltın veya yazı boyutunu küçültün.' : 'Shorten the title or reduce its size.'}</p>}
    {status && <p role={status === 'saved' ? 'status' : 'alert'}>{status === 'saved' ? (tr ? 'Kapak kaydedildi.' : 'Cover saved.') : status === 'frame' ? (tr ? 'Bu kare okunamadı. Başka bir zaman seçin.' : 'This frame could not be read. Select another time.') : (tr ? 'Kapak kaydedilemedi.' : 'Could not save the cover.')}</p>}
    <div className="shorts-actions">{(['png', 'jpg'] as const).map(format => <button key={format} type="button" className="export-cancel" disabled={!revision || !fits || capturing || saving} onClick={() => void save(format)}>{format.toUpperCase()} {tr ? 'kaydet' : 'save'}</button>)}</div>
  </section>
}
