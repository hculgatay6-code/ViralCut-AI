import { randomUUID } from 'node:crypto'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { batchSize, validateBatchItem } from '../server/shorts-batch.mjs'
import { keptSpans } from '../server/shorts.mjs'
import { ExportError } from '../server/media.mjs'
import { localPath } from './projects.mjs'

const appearance = { style: 'classic', font: 'arial', size: 52, position: 'bottom',
  textColor: '#ffffff', highlightColor: '#b7fa70', backgroundColor: '#151515', highlight: false }

export async function prepareDirector(request, parent, projects) {
  if (!batchSize(request) || !localPath(parent)) throw new ExportError('badEdit', 400)
  const source = projects.resolveMedia(request.mediaId)
  if (!source) throw new ExportError('missingProjectMedia')
  const directory = await realpath(parent)
  if (!localPath(directory) || !(await stat(directory)).isDirectory()) throw new ExportError('saveFailed')
  const settings = request.items.map(item => validateBatchItem(item, request))
  const folder = join(directory, 'ViralCut-Director-' + randomUUID().slice(0, 12))
  await mkdir(folder)
  const projectFiles = []
  for (const [index, item] of settings.entries()) {
    const mediaId = request.mediaId
    const path = join(folder, 'Short-' + (index + 1) + '.viralcut')
    const effects = item.edgeFade ? { ...item.effects, fadeIn: Math.max(.25, item.effects?.fadeIn ?? 0),
      fadeOut: Math.max(.25, item.effects?.fadeOut ?? 0) } : item.effects
    await projects.save(path, { version: 1, media: [{ id: mediaId, cues: item.overlay?.cues ?? [] }],
      clips: keptSpans(item.start, item.end, item.edit.remove).map(span => ({ ...span, id: randomUUID(), mediaId, effects })),
      appearance: item.overlay?.appearance ?? appearance, frame: item.edit.frame, burn: !!item.overlay, profile: item.profile,
      mastering: item.mastering, encoder: request.encoder })
    projectFiles.push(path)
  }
  const plan = settings.map((item, index) => ({ start: item.start, end: item.end, remove: item.edit.remove, frame: item.edit.frame,
    effects: item.effects, edgeFade: item.edgeFade, mastering: item.mastering, subtitles: item.overlay?.cues.length ?? 0, project: 'Short-' + (index + 1) + '.viralcut' }))
  await writeFile(join(folder, 'Edit-plan.json'), JSON.stringify({ version: 1, resolution: request.resolution, clips: plan }, null, 2), { flag: 'wx', flush: true })
  return { folder, projectFiles }
}
