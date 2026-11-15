import { ExportClientError, localExporter } from '../export/client'
import type { ExportJob } from '../export/client'
import { createDirectorPlan } from './directorPlan'
import { editedDuration, safePauses } from './autoShorts'
import { colors, projectEdit, validateSteps } from './copilotPlan'
import type { Step } from './copilotPlan'
import { subtractSpeech } from '../project/model'
import type { Project, ProjectMedia } from '../project/model'
import type { ClipRange } from './model'
import type { PlannedShort } from './directorPlan'
import type { Language } from '../i18n'

const wait = () => new Promise<void>(resolve => setTimeout(resolve, 300))
export async function finished(job: ExportJob, signal: AbortSignal, progress: (value: number) => void) {
 while (!['ready', 'failed'].includes(job.phase)) {
  signal.throwIfAborted()
  progress(job.progress)
  await wait()
  job = await localExporter.status(job.id, signal)
 }
 signal.throwIfAborted()
 if (job.phase === 'failed') throw new ExportClientError(job.error ?? 'serviceError')
 progress(100)
}

export type ShortContext = { source: string; rows: PlannedShort[] }
export type Source = { media: ProjectMedia; file: File; duration: number }
export type RunOptions = {
 project: Project; source?: Source; selected: string; layerSelected?:string; timelineIndex?: number; short?: ShortContext; language: Language; signal: AbortSignal
 progress: (value: number) => void; onStep: (step: Step, note?: string) => void
 current: () => boolean
 select: (index: number, seconds?: number) => boolean
}

export async function executeCopilot(steps: Step[], options: RunOptions) {
 validateSteps(steps)
 const { source, signal, progress, language } = options
 const bridge = window.viralCutDesktop
 if (!bridge) throw Error('desktop')
 let project = options.project
 let short = options.short?.source === source?.media.id ? options.short : undefined
 let analysis: Awaited<ReturnType<typeof localExporter.shortsAnalysis>> | undefined
 let output: { ready: number; failed: number; wanted: number; warnings: string[] } | undefined
 const guard = () => { signal.throwIfAborted(); if (!options.current()) throw Error('stale') }
 const run = async <T,>(job: ExportJob, read: (id: string) => Promise<T>) => {
  try { await finished(job, signal, progress); guard(); return await read(job.id) }
  finally { await localExporter.release(job.id) }
 }
 const analyze = async (goal: number) => {
  if (!source || source.duration <= 0) throw Error('source')
  return run(await localExporter.analyzeShorts(source.media.id, 'auto', -38, .65, goal, source.duration, 'general', 'auto', true),
    id => localExporter.shortsAnalysis(id, signal))
 }
 const ensureProject = () => {
  if (project.clips.length) return
  if (!source) throw Error('source')
  project = { ...project, media: [source.media], clips: [{ id: crypto.randomUUID(), mediaId: source.media.id, start: 0, end: source.duration }] }
 }
 let resolution: 720 | 1080 | undefined
 let save = false
 const layered = steps.some(step=>step.tool==='layerLook' && step.preset!=='action')
 const applied: { step: Step; note?: string }[] = []
 const done = (step: Step, note?: string) => applied.push({ step, note })
 const complete = () => { for (const row of applied) options.onStep(row.step, row.note) }
 for (const step of steps) {
  guard()
  progress(0)
  if (step.tool === 'shorts') {
   analysis = await analyze(step.goal)
   const rows = createDirectorPlan(analysis, step.count, 'auto')
   if (!source || !rows.length) throw Error('noCandidates')
   short = { source: source.media.id, rows }
   done(step, String(rows.length) + '/' + step.count)
   continue
  }
  if (step.tool === 'export') { resolution = step.resolution || project.profile.resolution; continue }
  if (step.tool === 'save') { save = true; continue }
  if (step.tool === 'select' || step.tool === 'seek') {
   if (!options.select(step.index, step.tool === 'seek' ? step.seconds : undefined)) throw Error('range')
  } else if (step.tool === 'inspect') {
   const observed = await analyze(30)
   const longest = Math.max(0, ...observed.silences.map(span => span.end - span.start))
   done(step, longest.toFixed(2) + ' s'); continue
  } else if (short && step.tool === 'remove') {
   if (!short.rows[step.index]) throw Error('clips')
   short = { ...short, rows: short.rows.filter((_, i) => i !== step.index) }
  } else if (short && step.tool === 'length' && step.index === -2) {
   if (short.rows.some(row => row.item.end - row.item.start < step.seconds)) throw Error('range')
   short = { ...short, rows: short.rows.map(row => {
    const end = row.item.start + step.seconds
    const remove = row.item.remove.filter(span => span.end < end)
    return { ...row, item: { ...row.item, end, remove, overlay: row.item.overlay && {
     ...row.item.overlay, cues: row.item.overlay.cues.filter(cue => cue.start < end) } } }
   }) }
  } else if (short && ['captions', 'captionStyle', 'frame', 'silence', 'audio', 'effects', 'size'].includes(step.tool)) {
   if (step.tool === 'frame' && step.mode !== 'vertical' && step.mode !== 'track') throw Error('shortFrame')
   const change = (row: PlannedShort) => {
    const { item } = row
    if (step.tool === 'silence') {
     const cues = item.overlay?.cues ?? []
     const found = analysis?.silences ?? []
     const cuts: ClipRange[] = []
     for (const pause of safePauses(item, found, cues, .24)) {
      if (editedDuration(item, [...cuts, pause]) >= 15) cuts.push(pause)
     }
     return { ...row, item: { ...item, remove: cuts } }
    }
    if (step.tool === 'captions' || step.tool === 'size' || step.tool === 'captionStyle') {
     if (!item.overlay) return row
     const look = item.overlay.appearance
     const appearance = step.tool === 'captionStyle' ? { ...look, style: step.style === 'current' ? project.appearance.style : step.style } :
      step.tool === 'captions' ? { ...look, textColor: colors[step.color], highlightColor: colors[step.color] } :
      { ...look, size: Math.min(100, look.size + 8) }
     return { ...row, item: { ...item, overlay: { ...item.overlay, appearance } } }
    }
    if (step.tool === 'audio') return { ...row, item: { ...item, mastering: { target: -16, musicLevel: .14 } } }
    if (step.tool === 'effects') return { ...row, item: { ...item, effects: {}, edgeFade: false } }
    if (step.tool === 'frame') return { ...row, item: { ...item, frame: step.mode === 'track' ? { ...item.frame, fit: undefined, track: row.clip.track } : item.frame } }
    return row
   }
   if (step.tool === 'silence' && !analysis) analysis = await analyze(30)
   if ((step.tool === 'captions' || step.tool === 'size' || step.tool === 'captionStyle') && !short.rows.some(row => row.item.overlay)) throw Error('captionsMissing')
   if (step.tool === 'frame' && step.mode === 'track' && !short.rows.some(row => row.clip.track?.length)) throw Error('subjectMissing')
   short = { ...short, rows: short.rows.map(change) }
  } else if (step.tool === 'frame' && step.mode === 'track') {
   analysis = await analyze(30)
   const candidate = analysis.selection?.candidates.find(row => row.track?.length)
   if (!candidate || !source) throw Error('subjectMissing')
   ensureProject()
   if (project.clips.some(clip => clip.mediaId !== source.media.id)) throw Error('subjectMissing')
   project = { ...project, frame: { mode: 'vertical', x: 0, y: 0, zoom: 1, track: candidate.track } }
  } else if (step.tool === 'silence' || step.tool === 'transcribe') {
   ensureProject()
   if (!source || !project.media.some(media => media.id === source.media.id)) throw Error('source')
   if (step.tool === 'silence') {
    const transcript = project.media.find(media => media.id === source.media.id)?.cues ?? []
    const result = await run(await localExporter.createSilence(source.file, -38, .65, false), id => localExporter.silences(id, signal))
    if (result.truncated) throw Error('tooManyCuts')
    const cuts = safePauses({ start: 0, end: source.duration }, result.silences, transcript, .24)
    const clips = subtractSpeech(project.clips, source.media.id, cuts)
    if (clips.length > 500 || !clips.length) throw Error('range')
    project = { ...project, clips }
    done(step, String(cuts.length)); continue
   }
   const result = await run(await localExporter.createTranscript(source.file, 'auto', 'auto'), id => localExporter.transcript(id, signal))
   if (!result.cues.length) throw Error('captionsMissing')
   project = { ...project, burn: true, media: project.media.map(media => media.id === source.media.id ? { ...media, cues: result.cues } : media) }
  } else {
   if (step.tool!=='layerLook') ensureProject()
   project = projectEdit(project, step, options.selected, options.layerSelected)
   if (step.tool === 'join') resolution ??= project.profile.resolution
  }
  done(step)
 }
 guard()
 if (save) {
  if (!project.clips.length && !layered) {
   if (!short) ensureProject()
   else {
    const rows = short.rows
    if (!source || !rows.length) throw Error('noCandidates')
    const first = rows[0].item
    const cues = rows.flatMap(row => row.item.overlay?.cues ?? [])
      .sort((a, b) => a.start - b.start).filter((cue, i, all) => !i || cue.start !== all[i - 1].start)
    project = { ...project, media: [{ ...source.media, cues }], appearance: first.overlay?.appearance ?? project.appearance,
     frame: first.frame, clips: rows.flatMap(row => subtractSpeech([
      { id: crypto.randomUUID(), mediaId: source.media.id, start: row.item.start, end: row.item.end, effects: row.item.effects },
     ], source.media.id, row.item.remove)), mastering: first.mastering }
   }
  }
  const saved = await bridge.projects.save(project)
  if (!saved.filename) throw Error(saved.cancelled ? 'cancelled' : 'saveFailed')
  options.onStep({ tool: 'save' }, saved.filename)
 }
 if (resolution) {
  if (short) {
   if (!short.rows.length || !source) throw Error('noCandidates')
   const picked = await bridge.director.folder(language)
   guard()
   if (picked.error || picked.cancelled) throw Error(picked.cancelled ? 'cancelled' : picked.error)
   const batch = await bridge.director.start({ language, resolution, encoder: 'auto', mediaId: source.media.id, items: short.rows.map(row => row.item) })
   if (batch.error) throw Error(batch.error)
   const cancel = () => void bridge.director.cancel().catch(() => {})
   signal.addEventListener('abort', cancel, { once: true })
   try {
    let state = batch
    while (state.active) {
     guard()
     progress(state.items.reduce((sum, item) => sum + item.progress, 0) / state.items.length)
     await wait()
     state = await bridge.director.status()
    }
    const warnings = [...new Set(state.items.flatMap(item => item.warnings ?? []))]
    output = { ready: state.items.filter(item => item.phase === 'ready').length, failed: state.items.filter(item => item.phase === 'failed').length,
     wanted: short.rows.length, warnings }
    if (!output.ready) throw new ExportClientError(state.items.find(item => item.error)?.error ?? 'encodeFailed')
    options.onStep({ tool: 'export', resolution }, String(output.ready) + '/' + output.wanted)
   } catch (error) { cancel(); throw error }
   finally { signal.removeEventListener('abort', cancel) }
  } else {
   if (!layered) ensureProject()
   project = { ...project, profile: { ...project.profile, resolution } }
   const job = await (layered ? localExporter.createLayers(project) : localExporter.createSequence(project))
   const result = await run(job, id => localExporter.save(id, 'ViralCut-Copilot.mp4', signal))
   options.onStep({ tool: 'export', resolution }, result.filename)
  }
 }
 guard()
 complete()
 return { project, short, output }
}
