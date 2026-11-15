import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import type { Appearance, Cue } from './model'
import { captionMotion, captionParts, captionY, hasReliableWords } from '../../server/caption-design.mjs'

const fonts = { arial: 'Arial', segoe: 'Segoe UI', verdana: 'Verdana' }

export function CaptionPreview(props: { cue: Cue; appearance: Appearance; time: number; video: RefObject<HTMLVideoElement | null>; playing: boolean }) {
  const { appearance } = props
  if (appearance.safe || appearance.motion !== undefined || appearance.highlightMode !== undefined || appearance.y !== undefined) {
    return <DesignedCaption {...props} />
  }
  return <LegacyCaption {...props} />
}

function DesignedCaption({ cue, appearance, time, video, playing }: {
  cue: Cue; appearance: Appearance; time: number; video: RefObject<HTMLVideoElement | null>; playing: boolean
}) {
  const [sampleTime, setSampleTime] = useState(time)
  const caption = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)
  const timed = hasReliableWords(cue)
  useEffect(() => {
    const element = video.current
    if (!playing || !element) return
    let frame = 0
    let last = -1
    function tick() {
      const current = element!.currentTime
      const window = captionMotion(cue, appearance, current, timed).window
      const animated = current - cue.start < window || cue.end - current < window
      const word = timed && appearance.highlight ? cue.words?.findIndex(item => current < item.end) ?? -1 : -1
      const active = word >= 0 && current >= cue.words![word].start
      const bucket = animated ? Math.floor(current * 40) : 100000000 + 2 * word + Number(active)
      if (bucket !== last) { last = bucket; setSampleTime(current) }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [appearance, cue, playing, timed, video])
  const current = playing && sampleTime >= cue.start && sampleTime < cue.end ? sampleTime : time
  const motion = captionMotion(cue, appearance, current, timed)
  const vertical = appearance.safe || appearance.y !== undefined ? captionY(appearance) : { top: 9.26, middle: 50, bottom: 89.8 }[appearance.position]
  useEffect(() => {
    const element = caption.current
    const frame = element?.parentElement
    if (!element || !frame) return
    const measure = () => {
      const half = element.offsetHeight / 2
      const y = frame.clientHeight * vertical / 100
      setOverflow(y - half < frame.clientHeight * .1 || y + half > frame.clientHeight * .87 ||
        element.scrollWidth > element.clientWidth + 1)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element); observer.observe(frame); measure()
    return () => observer.disconnect()
  }, [vertical])
  const outline = appearance.outline ?? (appearance.style === 'bold' ? 4 : 3)
  const css = {
    top: `${vertical + motion.offset / 10.8}%`, opacity: motion.opacity,
    transform: `translate(-50%, -50%) scale(${motion.scale})`, color: appearance.textColor,
    fontFamily: fonts[appearance.font], fontSize: `${appearance.size / 10.8}cqh`,
    fontWeight: appearance.style === 'classic' ? 400 : 700,
    WebkitTextStroke: appearance.style === 'box' ? undefined : `${2 * outline / 10.8}cqh ${appearance.outlineColor ?? appearance.backgroundColor}`,
    paintOrder: 'stroke fill', backgroundColor: appearance.style === 'box' ? appearance.backgroundColor : undefined,
    textShadow: `${(appearance.shadow ?? 1) / 10.8}cqh ${(appearance.shadow ?? 1) / 10.8}cqh 0 ${appearance.backgroundColor}`,
  } as CSSProperties
  return <><span ref={caption} className="designed-caption" style={css}>
    {captionParts(cue, appearance, current, timed).map((part, index) => <span key={index} style={{ color: part.color }}>{part.text}</span>)}
  </span>{overflow && appearance.safe && <span className="caption-overflow" role="status">{document.documentElement.lang === 'tr' ? 'Altyazı güvenli alanı aşıyor.' : 'Caption extends beyond the safe area.'}</span>}</>
}

function LegacyCaption({ cue, appearance, time, video, playing }: {
  cue: Cue; appearance: Appearance; time: number; video: RefObject<HTMLVideoElement | null>; playing: boolean
}) {
  const { font, size, position, style, textColor, backgroundColor, highlight, highlightColor } = appearance
  const [activeWord, setActiveWord] = useState(-1)
  const words = highlight ? cue.words : undefined
  useEffect(() => {
    const element = video.current
    if (!element || !playing || !words) return
    let frame = 0
    const update = () => {
      const currentTime = element.currentTime
      setActiveWord(words.findIndex(word => currentTime >= word.start && currentTime < word.end))
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [playing, video, words])
  const highlighted = playing ? activeWord : words?.findIndex(word => time >= word.start && time < word.end)
  const css = {
    color: textColor, fontFamily: fonts[font], fontSize: 'clamp(10px, ' + size / 19.2 + 'cqi, 64px)',
    '--caption-background': backgroundColor,
  } as CSSProperties
  return (
    <span className={'stage-caption actual-caption caption-' + position + ' subtitle ' + style} style={css}>
      {words ? words.map((word, index) =>
        <span key={index} style={{ color: index === highlighted ? highlightColor : undefined }}>{word.text}</span>
      ) : cue.text}
    </span>
  )
}
