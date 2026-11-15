const limits = { brightness: [-.18, .18], contrast: [.75, 1.3], saturation: [.4, 1.5], sharpness: [0, .65],
  noise: [0, 18], fadeIn: [0, 3], fadeOut: [0, 3], warmth: [-.08, .08] }

function number(value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw Error('badEdit')
  return value
}

export function validateEffects(raw) {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('badEdit')
  const clean = {}
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (raw[key] !== undefined) clean[key] = number(raw[key], min, max)
  }
  for (const key of ['normalize', 'voice']) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'boolean') throw Error('badEdit')
    clean[key] = raw[key]
  }
  if (raw.zoom !== undefined) {
    const { start, end, from, to } = raw.zoom ?? {}
    clean.zoom = { start: number(start, 0, 864000), end: number(end, start + .1, 864000),
      from: number(from, 1, 1.65), to: number(to, 1, 1.65) }
  }
  if (raw.zoomReturn !== undefined) {
    const { start, end } = raw.zoomReturn ?? {}
    if (!clean.zoom) throw Error('badEdit')
    clean.zoomReturn = { start: number(start, clean.zoom.end, 864000), end: number(end, start + .1, 864000) }
  }
  return clean
}

export function validateTransition(raw) {
  if (raw === undefined) return undefined
  if (!raw || !['fade', 'dissolve', 'slideleft'].includes(raw.kind)) throw Error('badEdit')
  return { kind: raw.kind, duration: number(raw.duration, .15, 1.5) }
}

const fixed = value => Number(value).toFixed(6)

export function videoEffects(effects, from, fps, width, height) {
  if (!effects) return ''
  const filters = []
  const { zoom, zoomReturn, brightness = 0, contrast = 1, saturation = 1, sharpness = 0, warmth = 0 } = effects
  if (zoom && zoom.from !== zoom.to) {
    const progress = `clip((on/${fps}+${fixed(from - zoom.start)})/${fixed(zoom.end - zoom.start)},0,1)`
    // Cosine easing matches the editor preview. Zoompan emits one frame per CFR input frame.
    const retreat = zoomReturn ? `-(${fixed(zoom.to - zoom.from)})*(1-cos(PI*clip((on/${fps}+${fixed(from - zoomReturn.start)})/${fixed(zoomReturn.end - zoomReturn.start)},0,1)))/2` : ''
    const expression = `${fixed(zoom.from)}+(${fixed(zoom.to - zoom.from)})*(1-cos(PI*${progress}))/2${retreat}`
    filters.push(`fps=${fps}:start_time=0,zoompan=z='${expression}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${width}x${height}:fps=${fps}`)
  }
  if (brightness || contrast !== 1 || saturation !== 1) filters.push(`eq=brightness=${fixed(brightness)}:contrast=${fixed(contrast)}:saturation=${fixed(saturation)}`)
  if (warmth) filters.push(`colorbalance=rm=${fixed(warmth)}:bm=${fixed(-warmth)}:pl=1`)
  if (sharpness) filters.push(`unsharp=5:5:${fixed(sharpness)}:5:5:0`)
  return filters.length ? ',' + filters.join(',') : ''
}

export function audioEffects(effects, length, { first = true, last = true, edge = 0, offset, fullLength } = {}) {
  if (!effects && !edge) return ''
  const { noise = 0, voice, normalize, fadeIn = 0, fadeOut = 0 } = effects ?? {}
  const filters = []
  if (noise) filters.push(`afftdn=nr=${fixed(noise)}:nf=-45:tn=1:gs=5`)
  if (voice) filters.push('highpass=f=85,equalizer=f=2900:t=q:w=1.15:g=2.5')
  if (normalize) filters.push('dynaudnorm=f=250:g=9:p=0.85:m=4:r=0.17,alimiter=limit=0.86:level=0:latency=1')
  if (fullLength !== undefined) {
    const leading = Math.min(fullLength / 2, fadeIn)
    const trailing = Math.min(fullLength / 2, fadeOut)
    if (leading && offset < leading) filters.push(`volume='clip((t+${fixed(offset)})/${fixed(leading)},0,1)':eval=frame`)
    if (trailing && offset + length > fullLength - trailing) filters.push(`volume='clip((${fixed(fullLength - offset)}-t)/${fixed(trailing)},0,1)':eval=frame`)
    return filters.length ? ',' + filters.join(',') : ''
  }
  const leading = Math.min(length / 2, first ? Math.max(edge, fadeIn) : 0)
  const trailing = Math.min(length / 2, last ? Math.max(edge, fadeOut) : 0)
  if (leading) filters.push(`afade=t=in:st=0:d=${fixed(leading)}`)
  if (trailing) filters.push(`afade=t=out:st=${fixed(length - trailing)}:d=${fixed(trailing)}`)
  return filters.length ? ',' + filters.join(',') : ''
}

export function videoEdgeFade(length, edge, first, last) {
  const fade = fixed(Math.min(edge, length / 2))
  return (first ? `,fade=t=in:st=0:d=${fade}` : '') + (last ? `,fade=t=out:st=${fixed(length - Number(fade))}:d=${fade}` : '')
}
