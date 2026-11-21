const limit = value => Math.max(0, Math.min(1, value))
const percent = value => Math.round(100 * limit(value))
const center = box => (box.left + box.right) / 2

export function visualWindow(rows, start, end) {
  function lowerBound(time) {
    let left = 0, right = rows.length
    while (left < right) {
      const middle = (left + right) >>> 1
      if (rows[middle].time < time) left = middle + 1
      else right = middle
    }
    return left
  }
  return rows.slice(lowerBound(start), lowerBound(end))
}

export function visualMetrics(rows, start, end) {
  const inRange = visualWindow(rows, start, end)
  const count = inRange.length || 1
  return {
    motion: percent(inRange.reduce((sum, row) => sum + Math.min(1, row.motion), 0) / count),
    events: inRange.filter(row => row.cut || row.burst).length,
    objects: [...new Set(inRange.flatMap(row => row.labels))].slice(0, 8),
  }
}

export function rankVisual(rows, duration, goal, gaming, energy = [], count = 5) {
  if (duration < 15 || !rows.length) return []
  const length = Math.min(goal, duration)
  const options = new Set([0, Math.max(0, duration - length)])
  for (const row of rows) {
    if (row.cut || row.burst || row.motion >= .4) {
      options.add(Math.max(0, Math.min(duration - length, row.time - length * .26)))
    }
  }
  const signature = (start, end) => {
    const samples = visualWindow(rows, start, end)
    const bins = Array(16).fill(0)
    for (const row of samples) for (let index = 0; index < bins.length; index++) bins[index] += row.histogram[index] / Math.max(1, samples.length)
    return bins
  }
  const optionsRanked = [...options].map(start => {
    const end = start + length
    const visual = visualMetrics(rows, start, end)
    const samples = visualWindow(energy, start, end)
    const sound = samples.length ? percent(samples.reduce((sum, row) => sum + limit((row.db + 52) / 32), 0) / samples.length) : null
    const score = Math.round(visual.motion * (gaming ? .66 : .48) + Math.min(1, visual.events / 4) * (gaming ? 20 : 23) +
      Math.min(1, visual.objects.length / 3) * (gaming ? 4 : 16) + 9 * length / goal + (sound ?? 30) * .06)
    return { start, end, visual, sound, score }
  }).sort((a, b) => b.score - a.score || a.start - b.start)
  const chosen = []
  for (const item of optionsRanked) {
    if (chosen.some(other => Math.min(other.end, item.end) - Math.max(other.start, item.start) > length * .15)) continue
    const bins = signature(item.start, item.end)
    const duplicate = chosen.some(other => {
      const delta = bins.reduce((sum, value, i) => sum + Math.abs(value - other.bins[i]), 0)
      return delta < .12 && Math.abs(item.visual.motion - other.visual.motion) < 9
        && item.visual.objects.join() === other.visual.objects.join()
    })
    if (duplicate) continue
    const id = chosen.length
    chosen.push({ ...item, bins, id, boundaries: 0, speech: 0, text: '', selected: id < 3,
      evaluation: { score: item.score, metrics: { motion: item.visual.motion, energy: item.sound,
        scene: percent(item.visual.events / 4), length: percent(length / goal) },
        reasons: [item.visual.motion > 30 ? 'motion' : null, item.visual.events ? 'change' : null,
          item.visual.objects.length ? 'objects' : null].filter(Boolean) } })
    if (chosen.length === count) break
  }
  return chosen.map(({ bins: _bins, sound: _sound, score: _score, ...item }) => item)
}

export function subjectTrack(detections, start, end, ratio, gradual = false) {
  if (!(ratio > 9 / 16)) return []
  const cropWidth = (9 / 16) / ratio
  const keys = []
  let x = 0, previous, lastTime = start - 1
  for (const row of detections) {
    if (row.time < start - 1 || row.time > end + 1) continue
    const targets = row.boxes.filter(box => box.label === 'face' || box.label === 'person')
    const options = targets.length ? targets : row.boxes.filter(box => box.score >= .65)
    const target = [...options].sort((a, b) => {
      const priority = box => box.score + (box.label === 'face' ? .25 : 0) - (previous === undefined ? 0 : Math.abs(center(box) - previous) * .45)
      return priority(b) - priority(a)
    })[0]
    previous = target && center(target)
    let wanted = target ? 2 * limit((previous - cropWidth / 2) / (1 - cropWidth)) - 1 : 0
    if (gradual && target) {
      const currentLeft = (x + 1) / 2 * (1 - cropWidth)
      const inset = cropWidth * .12
      if (target.left >= currentLeft + inset && target.right <= currentLeft + cropWidth - inset) wanted = x
    }
    const elapsed = Math.min(2, Math.max(.3, row.time - lastTime))
    const speed = gradual ? .38 : .65
    x += Math.max(-speed * elapsed, Math.min(speed * elapsed, (wanted - x) * (gradual ? .62 : .72)))
    keys.push({ time: row.time, x: +x.toFixed(4) })
    lastTime = row.time
  }
  return keys
}
