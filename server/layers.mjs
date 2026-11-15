import { stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { animatedVideo, animationExpression } from './animation-render.mjs'
import { effectFilters, transitionFilter, transitionMotion } from './effect-render.mjs'
import { buildAss, validateOverlay } from './ass.mjs'
import { encoderArgs, ExportError, inputOptions, probe, run } from './media.mjs'
import { outputSize, validateEdit, validateProfile } from './shorts.mjs'
import { ffmpegThreads } from './resource-budget.mjs'
import { layerLimits, timelineDocument } from './timeline-document.mjs'

export function validateLayeredSequence(settings, resolveMedia) {
  const { encoder, appearance, preview } = settings
  const profile = validateProfile(settings.profile)
  if (!resolveMedia || !profile || !['auto', 'cpu'].includes(encoder)) throw new ExportError('badEdit', 400)
  let timeline
  try { timeline = timelineDocument(settings.timeline, () => true) }
  catch { throw new ExportError('badEdit', 400) }
  if (profile.fps !== timeline.fps) throw new ExportError('badEdit', 400)
  const frame = settings.frame === undefined ? undefined : validateEdit({ frame: settings.frame }).frame
  const duration = Math.max(0, ...timeline.tracks.flatMap(track => track.clips.map(clip => clip.at + clip.length)))
  const from = preview === undefined ? 0 : preview?.from
  const to = preview === undefined ? duration : preview?.to
  if (![from, to].every(Number.isSafeInteger) || from < 0 || from >= to || to > duration ||
      (preview !== undefined && to - from > timeline.fps * 8)) throw new ExportError('badRange', 400)

  const solo = timeline.tracks.some(track => track.kind === 'audio' && !track.hidden && track.solo && !track.muted)
  const sources = new Map()
  const captions = []
  const visible = timeline.tracks.flatMap((track, trackIndex) => {
    if (track.hidden || (track.kind === 'audio' && (track.muted || (solo && !track.solo) || !track.gain))) return []
    return track.clips.flatMap((clip, index) => {
      if (clip.at >= to || clip.at + clip.length <= from) return []
      if (track.kind === 'caption' || track.kind === 'text') {
        if (settings.burn !== false) captions.push({ start: clip.at / timeline.fps, end: (clip.at + clip.length) / timeline.fps,
          text: clip.text, animation: clip.animation, title: track.kind === 'text' })
        return []
      }
      function resolve(item) {
        let source = sources.get(item.mediaId)
        if (!source) {
          source = resolveMedia(item.mediaId)
          if (!source) throw new ExportError('missingProjectMedia')
          sources.set(item.mediaId, source)
        }
        if (track.kind === 'video' && !['mp4', 'webm'].includes(source.format)) throw new ExportError('badSource')
        return { ...item, kind:track.kind, gain:track.gain, trackIndex, rangeStart:item.at, rangeEnd:item.at+item.length, ...source }
      }
      const current=resolve(clip)
      const spec=clip.incoming
      if (!spec || clip.at+spec.start+spec.length<=from) return [current]
      const prior=resolve(track.clips[index-1])
      return [current,{ ...prior, incoming:undefined, outgoing:true, rangeStart:clip.at, rangeEnd:clip.at+spec.start+spec.length }]
    })
  })
  const caption = captions.filter(cue => !cue.title)
  const title = captions.filter(cue => cue.title)
  const overlay = caption.length ? validateOverlay({ cues: caption, appearance }) : undefined
  const titles = title.length ? validateOverlay({ cues: title, appearance: { ...appearance, position: 'top', safe: true, y: 16 } }) : undefined
  const animatedCaptions = new Map(captions.filter(cue => cue.animation).map(cue => [cue, cue.animation]))
  const edges = new Set([from, to])
  const shortBlocks = [...visible.filter(clip => clip.animation?.opacity?.length > 1 || clip.effects?.some(effect => effect.keys?.length > 1)).map(clip => [clip.at, clip.at + clip.length]),
    ...[...animatedCaptions.keys()].map(cue => [Math.round(cue.start * timeline.fps), Math.round(cue.end * timeline.fps)])]
  for (const [start, end] of shortBlocks) {
    const step = 30 * timeline.fps
    // Global boundaries coalesce coincident animations and bound ASS/sendcmd storage.
    for (let at = (Math.floor(Math.max(from, start) / step) + 1) * step; at < Math.min(to, end); at += step) edges.add(at)
  }
  for (const clip of visible) {
    edges.add(Math.max(from, clip.rangeStart))
    edges.add(Math.min(to, clip.rangeEnd))
    if (!clip.outgoing) for (const effect of clip.effects ?? []) {
      for (const point of [effect.start,effect.end]) if (clip.at+point>from && clip.at+point<to) edges.add(clip.at+point)
    }
  }
  const boundaries = [...edges].sort((a, b) => a - b)
  const spans = boundaries.slice(1).map((end, index) => {
    const start = boundaries[index]
    const clips = visible.filter(clip => clip.rangeStart <= start && clip.rangeEnd >= end)
    if (clips.filter(clip => clip.kind === 'video').length > layerLimits.video ||
        clips.filter(clip => clip.kind === 'audio').length > layerLimits.audio) throw new ExportError('layerConcurrency', 400)
    return { start, end, clips }
  })
  return { kind: 'sequence', monitor: preview !== undefined, spans, profile, frame, encoder, overlay, titles, animatedCaptions }
}

function dimensions(value) { return Math.max(2, Math.round(value / 2) * 2) }

export async function encodeLayeredSequence({ spans, profile, frame, encoder, overlay, titles, animatedCaptions, directory, output, signal, onProgress }) {
  const fps = profile.fps
  const [width, height] = outputSize(frame, profile)
  const total = (spans.at(-1).end - spans[0].start) / fps
  const files = spans.map((_, index) => 'part-' + index + '.mkv')
  const scratch = ['layers.filters', ...Array.from({ length: layerLimits.video }, (_, i) => 'v' + i + '-alpha.cmd'), ...Array.from({ length: layerLimits.video }, (_,i) => 'v'+i+'-fx.cmd')]
  const cleanup = () => Promise.all([...files, ...scratch, 'parts.txt', 'caption.ass', 'edge-caption-a.ass']
    .map(name => unlink(join(directory, name)).catch(() => {})))
  const media = new Map()
  for (const { clips } of spans) for (const clip of clips) {
    signal.throwIfAborted()
    if (!media.has(clip.path)) {
      const file = await stat(clip.path).catch(() => null)
      if (!file?.isFile() || file.size !== clip.size) throw new ExportError('missingProjectMedia')
      const info = await probe(clip.path, clip.format, signal).catch(() => {
        signal.throwIfAborted()
        throw new ExportError('badSource')
      })
      media.set(clip.path, info)
    }
  }

  async function encode(gpu) {
    let elapsed = 0
    for (const [index, { start, end, clips }] of spans.entries()) {
      signal.throwIfAborted()
      const length = (end - start) / fps
      const sec = length.toFixed(9)
      const input = [], filters = [], videos = [], audios = []
      const indices = new Map()
      for (const clip of clips) {
        const info = media.get(clip.path)
        const seek = (clip.inFrame + (clip.outgoing ? clip.length-1 : start-clip.at)) / fps
        const duration = Number(info.format?.duration)
        if (!Number.isFinite(duration) || seek >= duration || !clip.outgoing && seek + length > duration + 0.05) throw new ExportError('badRange')
        const video = clip.kind === 'video'
        const exists = info.streams?.some(stream => video
          ? stream.codec_type === 'video' && stream.width > 0 && !stream.disposition?.attached_pic
          : stream.codec_type === 'audio')
        if (!exists && video) throw new ExportError('badSource')
        if (!exists) continue
        // A video layer and its independent audio item can share one demuxer.
        const key = JSON.stringify([clip.path, seek, !!clip.outgoing])
        const entry = indices.get(key) ?? { index: indices.size, videos: [], audios: [] }
        if (!indices.has(key)) {
          indices.set(key, entry)
          input.push('-threads', '1', ...inputOptions(clip.format), '-ss', seek.toFixed(9), '-t', (clip.outgoing ? 1/fps + .001 : length + 2/fps).toFixed(9), '-i', clip.path)
        }
        const queue = video ? videos : audios
        const label = (video ? 'v' : 'a') + queue.length
        queue.push({ clip, label })
        const labels = video ? entry.videos : entry.audios
        labels.push(label)
      }
      for (const entry of indices.values()) {
        for (const [labels, stream, filter] of [[entry.videos, 'V', 'split'], [entry.audios, 'a', 'asplit']]) {
          if (!labels.length) continue
          filters.push(`[${entry.index}:${stream}:0]${labels.length === 1 ? (stream === 'V' ? 'null' : 'anull') : filter + '=' + labels.length}` +
            labels.map(label => '[' + label + 'in]').join(''))
        }
      }

      filters.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${sec}[bg]`)
      let under = 'bg'
      async function overlayClip(entry, background, shift = {}) {
        const {clip,label}=entry
        const renderAt=clip.outgoing ? clip.at+clip.length-1 : start
        const stream=media.get(clip.path).streams.find(info=>info.codec_type==='video' && info.width && !info.disposition?.attached_pic)
        if (clip.effects?.length) {
          const [a,b]=String(stream.sample_aspect_ratio).split(':').map(Number)
          let ratio=stream.width/stream.height*(a>0&&b>0?a/b:1)
          if (Math.abs(Math.round((stream.side_data_list?.[0]?.rotation??0)/90))%2) ratio=1/ratio
          const fw=dimensions(Math.min(width,height*ratio)), fh=dimensions(Math.min(height,width/ratio))
          const fx=effectFilters(clip.effects,label,fw,fh,fps,renderAt-clip.at,clip.outgoing?1:end-start)
          if (fx.filters.length) {
            if (fx.script) await writeFile(join(directory,label+'-fx.cmd'),fx.script)
            filters.push(`[${label}in]fps=${fps}:start_time=0,scale=${fw}:${fh},setsar=1,format=yuv420p,`+
              (fx.script?`sendcmd=f=${label}-fx.cmd,`:'')+`null[${label}base]`,...fx.filters,
              `[${fx.current}]null[${label}treated]`)
          }
          entry.treated=fx.filters.length>0
        }
        const input=entry.treated?label+'treated':label+'in'
        const duration=clip.outgoing ? sec : '0.15'
        let composite
        if (clip.animation) {
          const {foreground,composite:graph,alpha}=animatedVideo(clip,label,background,width,height,fps,renderAt,clip.outgoing?1:end-start,stream)
          if (alpha.length) await writeFile(join(directory,label+'-alpha.cmd'),alpha.join('\n'))
          filters.push(foreground.replace('['+label+'in]','['+input+']').replace('stop_duration=0.15','stop_duration='+duration))
          composite=graph
        } else {
          filters.push(`[${input}]fps=${fps}:start_time=0,scale=${dimensions(width*clip.scale)}:${dimensions(height*clip.scale)}:`+
            `force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,setsar=1,format=rgba,colorchannelmixer=aa=${clip.opacity},tpad=stop_mode=clone:stop_duration=${duration}[${label}fg]`)
          composite=`[${background}][${label}fg]overlay=x='(W-w)*${clip.x}':y='(H-h)*${clip.y}':format=yuv420:eof_action=repeat[${label}out]`
        }
        for (const [key,value] of Object.entries(shift)) composite=composite.replace(new RegExp(key+"='([^']*)'"),(_,expr)=>key+"='("+expr+")+("+value+")'")
        filters.push(composite)
        return label+'out'
      }

      for (const entry of videos) {
        if (entry.clip.outgoing) continue
        const old=videos.find(other=>other.clip.outgoing && other.clip.trackIndex===entry.clip.trackIndex)
        if (!old) { under=await overlayClip(entry,under); continue }
        const {clip,label}=entry, spec=clip.incoming
        const elapsed=start-clip.at-spec.start
        const final=label+'transition'
        const base=label+'lower'
        filters.push(`[${under}]split=${spec.id==='fade'?3:2}[${base}a][${base}b]`+(spec.id==='fade'?`[${base}c]`:''))
        const previous=await overlayClip(old,base+'a',transitionMotion(spec,elapsed,fps,true))
        const fresh=await overlayClip(entry,base+'b',transitionMotion(spec,elapsed,fps,false))
        filters.push(transitionFilter(spec,elapsed,fps,previous,fresh,final,base+'c'))
        under=final
      }
      const captionFilters = []
      for (const [text, filename] of [[overlay, 'caption.ass'], [titles, 'edge-caption-a.ass']]) {
        if (!text?.cues.some(cue => cue.start < end / fps && cue.end > start / fps)) continue
        await writeFile(join(directory, filename), buildAss(text, start / fps, end / fps, frame, start / fps, { fps, channels: animatedCaptions ?? new Map() }))
        captionFilters.push('ass=' + filename)
      }
      filters.push(`[${under}]${[...captionFilters, 'format=yuv420p', 'setsar=1'].join(',')}[picture]`)
      for (const { clip, label } of audios) {
        const volume = clip.animation?.volume
        const gain = volume ? `asetnsamples=n=${48000 / fps}:p=0,volume='if(isnan(t),1,(${animationExpression(volume, start - clip.at, `round(t*${fps})`, 1)}))*${clip.gain}':eval=frame`
          : 'volume=' + clip.gain
        filters.push(`[${label}in]aresample=48000:first_pts=0,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo,${gain},apad,atrim=duration=${sec}[${label}out]`)
      }
      filters.push(audios.length
        ? audios.map(({ label }) => `[${label}out]`).join('') +
          `amix=inputs=${audios.length}:normalize=0,alimiter=limit=0.95:level=0:latency=1[mix]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${sec}[mix]`)
      await writeFile(join(directory, 'layers.filters'), filters.join(';'))
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-xerror',
        '-progress', 'pipe:1', '-stats_period', '0.25', ...input, '-filter_complex_threads', '2', '-/filter_complex', 'layers.filters',
        '-t', sec, '-map', '[picture]', '-map', '[mix]', '-map_metadata', '-1', '-map_chapters', '-1',
        ...encoderArgs(gpu, profile), '-bf', '0', '-c:a', 'pcm_s16le', '-f', 'matroska', files[index]], signal, line => {
        if (!line.startsWith('out_time_us=')) return
        const micros = Number(line.slice(12))
        if (Number.isFinite(micros)) onProgress(Math.min(93, Math.max(0, (elapsed + micros / 1e6) * 93 / total)))
      }, { cwd: directory })
      elapsed += length
    }
  }

  let gpu = encoder === 'auto'
  try {
    try { await encode(gpu) }
    catch (error) {
      signal.throwIfAborted()
      if (!gpu || error.message !== 'encodeFailed') throw error
      await cleanup()
      gpu = false
      await encode(false)
    }
    await writeFile(join(directory, 'parts.txt'), files.map((name, index) => 'file ' + name +
      '\nduration ' + ((spans[index].end - spans[index].start) / fps).toFixed(9)).join('\n') + '\n', { flag: 'wx' })
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-n', '-protocol_whitelist', 'file',
      '-f', 'concat', '-safe', '1', '-i', 'parts.txt', '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
      '-af', 'aresample=48000:async=1:first_pts=0', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-f', 'mp4', output],
    signal, undefined, { cwd: directory })
    onProgress(96)
    const [info, file] = await Promise.all([probe(output, 'mp4', signal), stat(output)])
    const video = info.streams?.find(stream => stream.codec_type === 'video')
    const audio = info.streams?.find(stream => stream.codec_type === 'audio')
    const duration = Number(info.format?.duration)
    const expectedFrames = spans.at(-1).end - spans[0].start
    if (!file.size || !Number.isFinite(duration) || Math.abs(duration - total) > 1 / fps + .035 ||
        Number(video?.nb_frames) !== expectedFrames ||
        video?.codec_name !== 'h264' || video.width !== width || video.height !== height || audio?.codec_name !== 'aac') {
      throw new ExportError('verifyFailed')
    }
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-threads', ffmpegThreads(2),
      ...inputOptions('mp4'), '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], signal)
    return { size: file.size, encoder: gpu ? 'NVENC' : 'CPU',
      verification: { duration, width, height, fps, audio: true, captions: !!(overlay || titles) } }
  } finally { await cleanup() }
}
