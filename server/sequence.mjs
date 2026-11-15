import { stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildAss, validateOverlay } from './ass.mjs'
import { encoderArgs, ExportError, inputOptions, probe, run } from './media.mjs'
import { frameFilter, outputSize, validateEdit, validateProfile } from './shorts.mjs'
import { audioEffects, validateEffects, validateTransition, videoEffects } from './effects.mjs'
import { masterStudioAudio, studioAudioSettings } from './studio-audio.mjs'
import { ffmpegThreads } from './resource-budget.mjs'

export function validateSequence(settings, resolveMedia) {
  const { clips, frame, profile, encoder, appearance } = settings
  const output = validateProfile(profile)
  if (!resolveMedia || !output || !['auto', 'cpu'].includes(encoder) ||
      !Array.isArray(clips) || clips.length === 0 || clips.length > 500) throw new ExportError('badEdit', 400)
  const framing = frame === undefined ? undefined : validateEdit({ frame }).frame
  const parts = clips.map(clip => {
    const source = clip && typeof clip.mediaId === 'string' && resolveMedia(clip.mediaId)
    if (!source) throw new ExportError('missingProjectMedia', 422)
    const { start, end, cues } = clip
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 ||
        end - start < 1 / output.fps || end > 864000) throw new ExportError('badRange', 400)
    const overlay = Array.isArray(cues) && cues.length ? validateOverlay({ appearance, cues }) : undefined
    if (cues !== undefined && !Array.isArray(cues)) throw new ExportError('badEdit', 400)
    if (clip.muteAudio !== undefined && typeof clip.muteAudio !== 'boolean') throw new ExportError('badEdit', 400)
    try {
      return { ...source, start, end, overlay, muteAudio: clip.muteAudio === true,
        effects: validateEffects(clip.effects), transition: validateTransition(clip.transition) }
    } catch { throw new ExportError('badEdit', 400) }
  })
  return { kind: 'sequence', parts, frame: framing, profile: output, encoder, mastering: studioAudioSettings(settings.mastering) }
}

export async function encodeSequence({ parts, frame, profile, encoder, directory, output, signal, onProgress, mastering }) {
  const probeCache = new Map()
  for (const part of parts) {
    signal.throwIfAborted()
    const file = await stat(part.path).catch(() => null)
    if (!file?.isFile() || file.size !== part.size) throw new ExportError('missingProjectMedia')
    if (!probeCache.has(part.path)) {
      const info = await probe(part.path, part.format, signal).catch(() => {
        signal.throwIfAborted()
        throw new ExportError('badSource')
      })
      probeCache.set(part.path, info)
    }
  }
  const sourceTimeline = parts.map(part => {
    const info = probeCache.get(part.path)
    const duration = Number(info.format?.duration)
    if (!info.streams?.some(stream => stream.codec_type === 'video' && stream.width > 0 && !stream.disposition?.attached_pic) ||
        !Number.isFinite(duration) || part.start >= duration || part.end > duration + 0.05) throw new ExportError('badRange')
    const end = Math.min(part.end, duration)
    const frames = Math.round((end - part.start) * profile.fps)
    if (!frames) throw new ExportError('badRange')
    return { ...part, end, frames, seconds: frames / profile.fps, audio: !part.muteAudio && info.streams.some(stream => stream.codec_type === 'audio') }
  })
  const fps = profile.fps
  const overlaps = sourceTimeline.map((part, index) => part.transition && sourceTimeline[index + 1]
    ? Math.min(Math.round(part.transition.duration * fps), Math.floor(part.frames / 2), Math.floor(sourceTimeline[index + 1].frames / 2)) : 0)
  const timeline = sourceTimeline.flatMap((part, index) => {
    const previous = overlaps[index - 1] ?? 0, after = overlaps[index]
    const slice = (original, start, frames, first, last) => ({ ...original, start, end: Math.min(original.end, start + frames / fps),
      frames, seconds: frames / fps, first, last, audioOffset: start - original.start, audioLength: original.seconds })
    const middle = part.frames - previous - after
    const segments = middle ? [{ parts: [slice(part, part.start + previous / fps, middle, !previous, !after)], seconds: middle / fps }] : []
    if (after) {
      const next = sourceTimeline[index + 1]
      segments.push({ parts: [slice(part, part.start + (part.frames - after) / fps, after, false, true),
        slice(next, next.start, after, true, false)], seconds: after / fps, transition: part.transition.kind })
    }
    return segments
  })
  const total = timeline.reduce((sum, segment) => sum + segment.seconds, 0)
  const [width, height] = outputSize(frame, profile)
  const temp = timeline.map((_, index) => 'part-' + index + '.mkv')
  const cleanup = () => Promise.all([...temp, 'parts.txt', 'edge-a.mkv', 'edge-b.mkv', 'studio-sequence.mkv'].map(name => unlink(join(directory, name)).catch(() => {})))
  const encode = async gpu => {
    let elapsed = 0
    const encodePart = async (part, target, transitionPart = false) => {
      signal.throwIfAborted()
      const overlay = transitionPart ? undefined : part.overlay
      if (overlay) await writeFile(join(directory, 'caption.ass'), buildAss(overlay, part.start, part.end, frame))
      const filters = frameFilter(frame, profile, part.start) + ',fps=' + fps + ':start_time=0' +
        videoEffects(part.effects, part.start, fps, width, height) + ',tpad=stop_mode=clone:stop_duration=0.15' +
        (overlay ? ',ass=caption.ass' : '')
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-n',
        '-progress', 'pipe:1', '-stats_period', '0.25', '-filter_threads', '2',
        '-threads', ffmpegThreads(4), ...inputOptions(part.format), '-ss', part.start.toFixed(6), '-i', part.path,
        ...(part.audio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
        '-t', part.seconds.toFixed(8), '-map', '0:V:0', '-map', part.audio ? '0:a:0' : '1:a:0',
        '-map_metadata', '-1', '-map_chapters', '-1', '-vf', filters, '-pix_fmt', 'yuv420p',
        ...(transitionPart ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-threads:v', '2'] : encoderArgs(gpu, profile)),
        '-bf', '0', '-af', 'aresample=48000:first_pts=0' + (part.audio ? audioEffects(part.effects, part.seconds,
          { first: part.first, last: part.last, offset: part.audioOffset, fullLength: part.audioLength }) : '') + ',apad', '-ac', '2',
        '-c:a', 'pcm_s16le', '-f', 'matroska', join(directory, target),
      ], signal, line => {
        if (!line.startsWith('out_time_us=')) return
        const micros = Number(line.slice(12))
        if (!transitionPart && Number.isFinite(micros)) onProgress(Math.max(0, Math.min(93, (elapsed + micros / 1000000) / total * 93)))
      }, { cwd: directory })
    }
    for (const [index, segment] of timeline.entries()) {
      if (!segment.transition) await encodePart(segment.parts[0], temp[index])
      else {
        const edges = ['edge-a.mkv', 'edge-b.mkv']
        try {
          await encodePart(segment.parts[0], edges[0], true)
          await encodePart(segment.parts[1], edges[1], true)
          const length = segment.seconds.toFixed(8)
          // The outgoing and incoming text share the screen during a transition.
          // Switch caption tracks at the midpoint to keep both readable.
          const boundary = Math.round(segment.seconds * fps / 2) / fps
          const captionScripts = segment.parts.flatMap((part, index) => {
            if (!part.overlay) return []
            const from = index ? boundary : 0
            const to = index ? segment.seconds : boundary
            const script = buildAss(part.overlay, part.start, part.start + to, frame, part.start + from)
            return [{ name: index ? 'edge-caption-b.ass' : 'edge-caption-a.ass', script }]
          })
          for (const { name, script } of captionScripts) await writeFile(join(directory, name), script)
          const format = `[0:v]fps=${fps},settb=1/${fps},setpts=PTS-STARTPTS[v0];[1:v]fps=${fps},settb=1/${fps},setpts=PTS-STARTPTS[v1];`
          const transition = segment.transition === 'fade' ? 'fadeblack' : segment.transition === 'dissolve' ? 'fade' : 'slideleft'
          const captions = captionScripts.map(({ name }) => ',ass=' + name).join('')
          const graph = format + `[v0][v1]xfade=transition=${transition}:duration=${length}:offset=0,format=yuv420p${captions}[v];` +
            `[0:a][1:a]acrossfade=d=${length}:c1=tri:c2=tri[a]`
          await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-n', '-filter_complex_threads', '1',
            ...edges.flatMap(name => ['-threads', '2', '-protocol_whitelist', 'file', '-i', name]), '-filter_complex', graph,
            '-map', '[v]', '-map', '[a]', '-t', length, ...encoderArgs(gpu, profile), '-bf', '0', '-c:a', 'pcm_s16le',
            '-f', 'matroska', temp[index]], signal, undefined, { cwd: directory })
        } finally {
          await Promise.all([...edges, 'edge-caption-a.ass', 'edge-caption-b.ass'].map(name => unlink(join(directory, name)).catch(() => {})))
        }
      }
      elapsed += segment.seconds
    }
  }

  let gpu = encoder === 'auto'
  try {
    try {
      await encode(gpu)
    } catch (error) {
      signal.throwIfAborted()
      if (!gpu || error.message === 'diskFull') throw error
      await cleanup()
      gpu = false
      await encode(false)
    }
    const list = temp.map((name, index) => 'file ' + name + '\nduration ' + timeline[index].seconds.toFixed(8))
    await writeFile(join(directory, 'parts.txt'), list.join('\n') + '\n', { flag: 'wx' })
    const intermediate = mastering ? join(directory, 'studio-sequence.mkv') : output
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file',
      '-f', 'concat', '-safe', '1', '-i', 'parts.txt', '-map', '0:v:0', '-map', '0:a:0',
      '-c:v', 'copy', '-af', 'aresample=48000:async=1:first_pts=0',
      ...(mastering ? ['-c:a', 'pcm_s16le', '-f', 'matroska'] : ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-f', 'mp4']),
      intermediate,
    ], signal, undefined, { cwd: directory })
    if (mastering) await masterStudioAudio(intermediate, output, total, true, mastering, undefined, signal)
    onProgress(96)
    const [info, file] = await Promise.all([probe(output, 'mp4', signal), stat(output)])
    const video = info.streams?.find(stream => stream.codec_type === 'video')
    const audio = info.streams?.find(stream => stream.codec_type === 'audio')
    const duration = Number(info.format?.duration)
    if (!file.size || !Number.isFinite(duration) || Math.abs(duration - total) > 0.15 ||
        video?.codec_name !== 'h264' || video.width !== width || video.height !== height || audio?.codec_name !== 'aac') {
      throw new ExportError('verifyFailed')
    }
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin', '-threads', '2', ...inputOptions('mp4'), '-i', output,
      '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-',
    ], signal)
    return { size: file.size, encoder: gpu ? 'NVENC' : 'CPU',
      verification: { duration, width, height, fps: profile.fps, audio: true, captions: sourceTimeline.some(part =>
        part.overlay?.cues.some(cue => cue.start < part.end && cue.end > part.start)) } }
  } finally {
    await cleanup()
  }
}
