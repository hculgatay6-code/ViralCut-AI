const stop = new Set('the a an is and but this that it of for to in on as at be was are we you i with or they bir ve bu da de ile mi mı mu mü için ama çok daha gibi kadar o ben sen biz ki değil olarak'.split(' '))
const tokens = text => (text.toLocaleLowerCase('tr').match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !stop.has(word))
const clamp = number => Math.max(0, Math.min(1, number))
const finished = /(?:[!?]|(?<!\.)\.)["”’')\]]*$/u
const trailing = /(?:\.{2,}|…)["”’')\]]*$/u
const question = /\?["”’')\]]*$/u
const continuation = /^(?:and|but|so|then|also|this|that|it|they|because|he|she|ve|ama|fakat|sonra|bunun|böylece|yani|çünkü|o|bu|bunlar)\b/iu
const questionStart = /^(?:why|how|what|which|who|where|when|can|could|do|does|did|is|are|neden|niçin|nasıl|hangi|kim|nerede|ne zaman|ne)\b/iu

export function speechUnits(raw, duration) {
  if (!Array.isArray(raw) || !Number.isFinite(duration) || duration <= 0) return []
  const cues = raw.slice(0, 10000).filter(cue => cue && Number.isFinite(cue.start) && Number.isFinite(cue.end) &&
    cue.start >= 0 && cue.end > cue.start && cue.start < duration && typeof cue.text === 'string' && cue.text.trim())
    .sort((a, b) => a.start - b.start)
  const units = []
  for (const cue of cues) {
    const tail = units.at(-1)
    const text = cue.text.trim().slice(0, 500)
    const end = Math.min(duration, cue.end)
    if (tail && (cue.start < tail.end - .035 || (!finished.test(tail.text) && cue.start - tail.end < .65 && cue.start - tail.start < 35))) {
      tail.text = (tail.text + ' ' + text).slice(0, 2200)
      tail.end = Math.max(tail.end, end)
      tail.words += tokens(text).length
      if (cue.words?.length) tail.lastWord = cue.words.at(-1).end
      else tail.lastWord = undefined
    } else units.push({ start: cue.start, end, text, words: tokens(text).length,
      firstWord: cue.words?.[0]?.start, lastWord: cue.words?.at(-1)?.end })
  }
  return units
}

export function cosine(a, b) {
  if (!a || !b) return 0
  let dot = 0, aa = 0, bb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2 }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0
}

function overlapWords(a, b) {
  if (!a.size || !b.size) return 0
  let count = 0
  for (const word of a) if (b.has(word)) count++
  return count / (a.size + b.size - count)
}

export function topicBoundaries(units, vectors) {
  const edges = Array(units.length).fill(false)
  if (!vectors) return edges
  const similarities = units.slice(1).map((unit, i) => cosine(vectors[i], vectors[i + 1]))
  const median = [...similarities].sort((a, b) => a - b)[Math.floor(similarities.length / 2)] ?? .83
  for (let i = 1; i < units.length; i++) {
    const score = similarities[i - 1]
    edges[i] = score < Math.min(.86, median - .035) && units[i - 1].words >= 4 && units[i].words >= 4
  }
  return edges
}

const percent = value => Math.round(clamp(value) * 100)

export function rankSemantic(units, vectors, silences, duration, goal, cancelled = () => {}, signals, visualRows, limit = 5) {
  const topic = topicBoundaries(units, vectors)
  const adjacent = vectors ? units.map((_, index) => cosine(vectors[index - 1], vectors[index])) : []
  const words = units.map(unit => new Set(tokens(unit.text)))
  const qa = units.map((unit, i) => {
    const next = units[i + 1]
    return !!next && next.start - unit.end <= 5 && next.words >= 3 && !question.test(next.text) &&
      (question.test(unit.text) || (unit.words <= 16 && questionStart.test(unit.text) && !finished.test(unit.text))) &&
      (!topic[i + 1] || adjacent[i + 1] >= .76)
  })
  const results = []
  const tolerance = goal === 15 ? 5 : goal === 30 ? 8 : 11
  const min = Math.max(15, goal - tolerance), max = Math.min(60, goal + tolerance)
  const quiet = Array.isArray(silences) ? silences.filter(span => span && span.end > span.start).sort((a, b) => a.start - b.start) : []
  let silenceIndex = 0
  let energyIndex = 0, sceneIndex = 0
  const energy = signals?.energy ?? [], scenes = signals?.scenes ?? []
  for (let first = 0; first < units.length; first++) {
    if (first % 32 === 0) cancelled()
    const lead = units[first], previous = units[first - 1]
    if (qa[first - 1] || (previous && lead.start < previous.end)) continue
    const start = Math.max(0, lead.start - Math.min(.15, (lead.start - (previous?.end ?? 0)) / 2))
    while (energy[energyIndex] && energy[energyIndex].time + signals.stride <= start) energyIndex++
    while (scenes[sceneIndex] < start - .5) sceneIndex++
    const sceneAligned = scenes.slice(sceneIndex, sceneIndex + 3).some(time => Math.abs(time - start) <= .5)
    let activity = 0, measurements = 0
    for (let index = energyIndex; energy[index]?.time < start + 3; index++) {
      activity += clamp((energy[index].db + 52) / 32)
      measurements++
    }
    while (quiet[silenceIndex]?.end <= start) silenceIndex++
    const shortlist = []
    let speech = 0, jumps = 0, pairs = 0, captions = 0, similarity = 0
    for (let last = first; last < units.length && last - first < 100; last++) {
      const tail = units[last], next = units[last + 1]
      speech += tail.end - tail.start
      if (last > first) {
        jumps += Number(topic[last] && !qa[last - 1]); pairs += Number(qa[last - 1])
        if (vectors) similarity += adjacent[last]
      }
      captions += Number(tail.end - tail.start >= .7 && tail.words / Math.max(.1, tail.end - tail.start) <= 4)
      const end = Math.min(duration, tail.end + Math.min(.15, Math.max(0, ((next?.start ?? duration) - tail.end) / 2)))
      const length = end - start
      if (length > max + .001) break
      if (length < min - .001 || qa[last] || (next && tail.end > next.start) || question.test(tail.text) || trailing.test(tail.text)) continue
      if (!finished.test(tail.text) && (!next || next.start - tail.end < .65)) continue
      if (speech / length < .35) continue
      let silence = 0
      for (let i = silenceIndex; quiet[i] && quiet[i].start < end; i++) silence += Math.max(0, Math.min(end, quiet[i].end) - Math.max(start, quiet[i].start))
      const count = last - first + 1
      const clarity = 1 - Math.min(.65, jumps * .23)
      const related = vectors && count > 1 ? clamp((similarity / (count - 1) - .65) / .3) : .55
      const metrics = {
        coherence: vectors ? percent(.38 + related * .39 + clarity * .2 + Math.min(.09, pairs * .09)) : null,
        hook: percent(qa[first] ? .94 : continuation.test(lead.text) ? .4 : (topic[first] || !previous) && lead.words >= 4 ? .86 : .67),
        completion: percent(finished.test(tail.text) ? .86 + (pairs ? .1 : 0) : .61),
        silence: Math.round(clamp(silence / length) * 100),
        captions: percent(captions / count),
        length: percent(1 - Math.abs(goal - length) / (tolerance * 2)),
        similarity: 0,
        energy: measurements ? percent(activity / measurements) : null,
        scene: signals ? sceneAligned ? 100 : 0 : null,
        timing: Number.isFinite(lead.firstWord) && Number.isFinite(tail.lastWord) ?
          percent(1 - Math.max(0, start - lead.firstWord, tail.lastWord - end) * 4) : null,
      }
      const rank = (metrics.coherence ?? 62) * .32 + metrics.hook * .13 + metrics.completion * .25 +
        (100 - metrics.silence) * .11 + metrics.captions * .07 + metrics.length * .12
      const adjustments = [[metrics.energy, 4], [metrics.scene, 2], [metrics.timing, 4]].filter(([value]) => value !== null)
      const visual = visualRows?.length ? visualMetrics(visualRows, start, end) : null
      if (visual) {
        metrics.motion = visual.motion
        adjustments.push([visual.motion, 5], [Math.min(100, 25 * visual.events), 3], [Math.min(100, 35 * visual.objects.length), 4])
      }
      const weight = adjustments.reduce((sum, [, value]) => sum + value, 0)
      const weighted = (rank * (100 - weight) + adjustments.reduce((sum, [value, share]) => sum + value * share, 0)) / 100
      shortlist.push({ start, end, first, last, rank: weighted, metrics, reasons: [pairs ? 'qa' : null,
        topic[first] ? 'topic' : null, finished.test(tail.text) ? 'completed' : null,
        !continuation.test(lead.text) ? 'standalone' : null, sceneAligned ? 'scene' : null,
        metrics.energy >= 65 ? 'energy' : null, visual?.motion > 30 ? 'motion' : null,
        visual?.objects.length ? 'objects' : null].filter(Boolean), speech: clamp(speech / length) })
    }
    results.push(...shortlist.sort((a, b) => b.rank - a.rank).slice(0, 5))
  }
  results.sort((a, b) => b.rank - a.rank || a.start - b.start)
  const chosen = []
  const mean = (first, last) => {
    if (!vectors?.[first]) return null
    const accum = new Float32Array(vectors[first].length)
    for (let row = first; row <= last; row++) for (let dim = 0; dim < accum.length; dim++) accum[dim] += vectors[row][dim]
    return accum
  }
  for (const [index, item] of results.entries()) {
    if (index % 128 === 0) cancelled()
    if (chosen.some(other => Math.min(other.end, item.end) - Math.max(other.start, item.start) >
        .14 * Math.min(other.end - other.start, item.end - item.start))) continue
    const lexicon = new Set(words.slice(item.first, item.last + 1).flatMap(set => [...set]))
    const vector = mean(item.first, item.last)
    let likeness = 0
    let duplicate = false
    for (const other of chosen) {
      const lexical = overlapWords(lexicon, other.lexicon)
      const semantic = vectors ? cosine(vector, other.vector) : 0
      likeness = Math.max(likeness, lexical, semantic)
      if (lexical >= .76 || (semantic >= .94 && lexical >= .14) || semantic >= .978) { duplicate = true; break }
    }
    if (duplicate) continue
    chosen.push({ ...item, lexicon, vector, metrics: { ...item.metrics, similarity: percent(likeness) } })
    if (chosen.length === limit) break
  }
  return chosen.map(({ start, end, first, last, rank, metrics, reasons, speech }, id) => ({ id, start, end, speech,
    selected: id < 3, boundaries: 0, text: units.slice(first, last + 1).map(unit => unit.text).join(' ').slice(0, 3000),
    evaluation: { score: Math.round(rank), metrics, reasons } }))
}
import { visualMetrics } from './visual-ranking.mjs'
