import { bezierPresets, keyframeValue } from './keyframes.mjs'

const num = value => String(Number(value.toFixed(9)))
const polynomial = (t, a, b) => `(3*${num(a)}*(1-${t})^2*${t}+3*${num(b)}*(1-${t})*${t}^2+${t}^3)`

// The renderer and libavutil both invert cubic time with the same 22 bisection steps.
export function animationExpression(points, offset, time, fallback) {
  if (!points?.length) return num(fallback)
  if (points.length === 1) return num(points[0].value)
  const f = `(${time}+${offset})`
  const intervals = points.map((a, index) => {
    const b = points[index + 1]
    if (!b || a.curve === 'hold' || a.value === b.value) return num(a.value)
    const progress = `clip((${f}-${a.frame})/${b.frame - a.frame},0,1)`
    const delta = num(b.value - a.value)
    if (a.curve === 'linear') return `${num(a.value)}+(${delta})*${progress}`
    const [x1, y1, x2, y2] = a.curve === 'bezier' ? a.bezier : bezierPresets[a.curve]
    const mid = 'ld(3)'
    return `(st(0,0);st(1,1);st(2,0);st(4,${progress});` +
      `while(lt(ld(2),22),st(3,(ld(0)+ld(1))/2);if(lt(${polynomial(mid, x1, x2)},ld(4)),st(0,${mid}),st(1,${mid}));st(2,ld(2)+1));` +
      `st(3,(ld(0)+ld(1))/2);${num(a.value)}+(${delta})*${polynomial(mid, y1, y2)})`
  })
  function tree(from, to) {
    if (from === to) return intervals[from]
    const edge = (from + to + 1) >> 1
    return `if(lt(${f},${points[edge].frame}),${tree(from, edge - 1)},${tree(edge, to)})`
  }
  return `if(lte(${f},${points[0].frame}),${num(points[0].value)},${tree(0, intervals.length - 1)})`
}

export function opacityCommands(values, offset, length, fps, target) {
  let previous
  const commands = []
  for (let i = 0; i < length; i++) {
    const value = Math.round(keyframeValue(values, offset + i, 1) * 255) / 255
    if (previous === value) continue
    previous = value
    // Give libavfilter a small timestamp margin for floating point rounding.
    const seconds = Math.max(0, i / fps - 0.000002).toFixed(9)
    commands.push(`${seconds} ${target} aa ${num(value)};`)
  }
  return commands
}

export function animatedVideo(clip, label, under, width, height, fps, start, count, stream) {
  const { animation = {} } = clip
  const offset = start - clip.at
  const byTime = `round(t*${fps})`
  const expression = (key, fallback, time = byTime) => animationExpression(animation[key], offset, time, fallback)
  const x = expression('x', clip.x), y = expression('y', clip.y)
  const scale = expression('scale', clip.scale)
  const rotation = animation.rotation ? `rotate=angle='(${expression('rotation', 0)})*PI/180':ow=iw:oh=ih:c=black@0,` : ''
  const alpha = animation.opacity ? opacityCommands(animation.opacity, offset, count, fps, 'colorchannelmixer@' + label + 'alpha') : []
  const opacity = alpha.length
    ? `sendcmd=f=${label}-alpha.cmd,colorchannelmixer@${label}alpha=aa=${keyframeValue(animation.opacity, offset, clip.opacity)},`
    : clip.opacity !== 1 ? `colorchannelmixer=aa=${clip.opacity},` : ''
  // Framesync negotiates a fixed overlay size. Pad changing source boxes before
  // framesync and compensate for the padding in the original track alignment.
  const [sarW, sarH] = String(stream.sample_aspect_ratio).split(':').map(Number)
  const turn = stream.side_data_list?.find(side => Number.isFinite(side.rotation))?.rotation ?? 0
  let ratio = (stream.width / stream.height) * (sarW > 0 && sarH > 0 ? sarW / sarH : 1)
  if (Math.abs(Math.round(turn / 90)) % 2) ratio = 1 / ratio
  const even = count => Math.max(2, Math.ceil(count / 2) * 2)
  const animatedScale = animation.scale && animation.scale.length > 1
  const dims = [width, height].map(size => `max(2,round(${size}*(${scale})/2)*2)`)
  const [fitWidth, fitHeight] = [
    `max(2,trunc(min(${dims[0]},${dims[1]}*${num(ratio)})/2)*2)`,
    `max(2,trunc(min(${dims[1]},${dims[0]}/${num(ratio)})/2)*2)`,
  ]
  const maxScale = Math.max(...(animation.scale?.map(point => point.value) ?? [clip.scale]))
  const pad = animatedScale ? `pad=${even(width*maxScale)+4}:${even(height*maxScale)+4}:(ow-iw)/2:(oh-ih)/2:color=black@0:eval=frame,` : ''
  const position = (canvas, box, foreground, key, expression) => `(${canvas}-${box})*(${expression})` +
    (animation[key] ? `+max(0,${box}-.75*${canvas})*((${expression})-${clip[key]})` : '') +
    (animatedScale ? `+(${box}-${foreground})/2` : '')
  const xPosition = position('W', animatedScale ? fitWidth : 'w', 'w', 'x', x)
  const yPosition = position('H', animatedScale ? fitHeight : 'h', 'h', 'y', y)
  const foreground = `[${label}in]fps=${fps}:start_time=0,format=rgba,${rotation}` +
    `scale=w='max(2,round(${width}*(${scale})/2)*2)':h='max(2,round(${height}*(${scale})/2)*2)':` +
    `eval=frame:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,` +
    `setsar=1,format=rgba,${opacity}${pad}tpad=stop_mode=clone:stop_duration=0.15[${label}fg]`
  const composite = `[${under}][${label}fg]overlay=x='${xPosition}':y='${yPosition}':format=yuv420:eof_action=repeat[${label}out]`
  return { foreground, composite, alpha }
}
