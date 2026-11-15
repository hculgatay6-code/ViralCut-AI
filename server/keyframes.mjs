export const keyframeBounds = Object.freeze({
  x: [0, 1], y: [0, 1], scale: [0.1, 2], rotation: [-360, 360], opacity: [0, 1], volume: [0, 2], reveal: [0, 1],
})
export const parametersByKind = Object.freeze({
  video: ['x', 'y', 'scale', 'rotation', 'opacity'],
  audio: ['volume'],
  caption: ['x', 'y', 'scale', 'rotation', 'opacity', 'reveal'],
  text: ['x', 'y', 'scale', 'rotation', 'opacity', 'reveal'],
})
export const keyframeLimits = Object.freeze({ channel: 128, project: 12000 })
export const curves = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold', 'bezier']
export const bezierPresets = {
  'ease-in': [.42, 0, 1, 1], 'ease-out': [0, 0, .58, 1], 'ease-in-out': [.42, 0, .58, 1],
}
const coordinate = number => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1

export function keyframeDocument(animation, kind, length) {
  if (animation === undefined) return undefined
  if (!animation || typeof animation !== 'object' || Array.isArray(animation)) throw Error('badTimeline')
  const output = {}
  for (const [parameter, points] of Object.entries(animation)) {
    if (!parametersByKind[kind]?.includes(parameter) || !Array.isArray(points) ||
        points.length < 1 || points.length > keyframeLimits.channel) throw Error('badTimeline')
    const [min, max] = keyframeBounds[parameter]
    let last = -1
    output[parameter] = points.map(point => {
      if (!point || !Number.isSafeInteger(point.frame) || point.frame <= last || point.frame >= length ||
          !Number.isFinite(point.value) || point.value < min || point.value > max ||
          !curves.includes(point.curve)) throw Error('badTimeline')
      last = point.frame
      const { frame, value, curve, bezier } = point
      if (curve === 'bezier') {
        if (!Array.isArray(bezier) || bezier.length !== 4 || !bezier.every(coordinate)) throw Error('badTimeline')
        return { frame, value, curve, bezier: [...bezier] }
      }
      if (bezier !== undefined) throw Error('badTimeline')
      return { frame, value, curve }
    })
  }
  return Object.keys(output).length ? output : undefined
}

function cubic(t, a, b) {
  return 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3
}

export function curveValue(progress, curve, bezier) {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  if (curve === 'hold') return 0
  if (curve === 'linear') return progress
  const [x1, y1, x2, y2] = curve === 'bezier' ? bezier : bezierPresets[curve]
  let low = 0, high = 1
  for (let i = 0; i < 22; i++) {
    const mid = (low + high) / 2
    if (cubic(mid, x1, x2) < progress) low = mid
    else high = mid
  }
  return cubic((low + high) / 2, y1, y2)
}

export function keyframeValue(points, frame, fallback) {
  if (!points?.length) return fallback
  if (frame <= points[0].frame) return points[0].value
  if (frame >= points.at(-1).frame) return points.at(-1).value
  let low = 0, high = points.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (points[middle].frame <= frame) low = middle
    else high = middle
  }
  const a = points[low], b = points[high]
  return a.value + (b.value - a.value) * curveValue((frame - a.frame) / (b.frame - a.frame), a.curve, a.bezier)
}

// Shift a channel and evaluate its exact values at new clip boundaries. Curves split
// within a segment retain their shape using a de Casteljau split in parametric time.
function sliceCurve(point, start, end) {
  const config = point.curve === 'bezier' ? point.bezier : bezierPresets[point.curve]
  if (!config || (start === 0 && end === 1)) return { curve: point.curve, ...(point.bezier ? { bezier: point.bezier } : {}) }
  const [x1, y1, x2, y2] = config
  function inverse(x) {
    if (x <= 0 || x >= 1) return x
    let low = 0, high = 1
    for (let i = 0; i < 25; i++) {
      const mid = (low + high) / 2
      if (cubic(mid, x1, x2) < x) low = mid
      else high = mid
    }
    return (low + high) / 2
  }
  const u = inverse(start), v = inverse(end)
  const derivative = (t, a, b) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * (1 - t) * t + 3 * (1 - b) * t ** 2
  const controls = (a, b) => {
    const distance = cubic(v, a, b) - cubic(u, a, b)
    if (distance < 1e-9) return [1 / 3, 2 / 3]
    return [derivative(u, a, b) * (v - u) / (3 * distance), 1 - derivative(v, a, b) * (v - u) / (3 * distance)]
  }
  const [xa, xb] = controls(x1, x2), [ya, yb] = controls(y1, y2)
  return { curve: 'bezier', bezier: [xa, ya, xb, yb].map(value => Math.max(0, Math.min(1, value))) }
}

export function sliceAnimation(animation, offset, length) {
  if (!animation) return undefined
  const last = offset + length - 1
  return Object.fromEntries(Object.entries(animation).map(([parameter, points]) => {
    const frames = new Set([offset, last])
    for (const point of points) if (point.frame > offset && point.frame < last) frames.add(point.frame)
    const ordered = [...frames].sort((a, b) => a - b)
    let index = -1
    return [parameter, ordered.map((frame, order) => {
      while (index + 1 < points.length && points[index + 1].frame <= frame) index++
      const point = points[index], next = points[index + 1]
      const stop = ordered[order + 1]
      const easing = point && next && stop !== undefined && stop <= next.frame
        ? sliceCurve(point, (frame - point.frame) / (next.frame - point.frame), (stop - point.frame) / (next.frame - point.frame))
        : { curve: 'linear' }
      return { frame: frame - offset, value: keyframeValue(points, frame, 0), ...easing }
    })]
  }))
}

export function joinAnimation(left, right, length) {
  if (!left && !right) return undefined
  const channels = Object.keys(left ?? {})
  if (!left || !right || channels.length !== Object.keys(right).length || channels.some(key => !right[key])) return null
  return Object.fromEntries(channels.map(key => {
    const a = left[key], b = right[key]
    // Before the first key and after the last key, each source clip holds that value.
    // Preserve both sides as a hard boundary in the joined clip.
    const outgoing = { frame: a.at(-1).frame, value: a.at(-1).value, curve: 'hold' }
    const next = b.map(point => ({ ...point, frame: point.frame + length }))
    if (b[0].frame) next.unshift({ frame: length, value: b[0].value, curve: 'hold' })
    return [key, [...a.slice(0, -1), outgoing, ...next]]
  }))
}
