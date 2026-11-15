import { useEffect, useRef, useState } from 'react'
import type { Copy } from '../i18n'
import { ExportClientError, localExporter } from '../export/client'
import type { Cue } from '../subtitles/model'
import { suggestZoom } from './effects'
import type { StudioEffects } from './effects'
import type { ClipRange } from './model'
import type { Edit } from './shorts'

type Props = { copy: Copy; audio: boolean; file?: File; range: ClipRange; edit?: Edit; cues: Cue[]; effects?: StudioEffects; pause: () => void;
  update: (effects?: StudioEffects) => void; undo: () => void; compare: boolean; setCompare: (value: boolean) => void }

const colorFields = { brightness: [0, -.18, .18, .01], contrast: [1, .75, 1.3, .01], saturation: [1, .4, 1.5, .01], sharpness: [0, 0, .65, .05] } as const
const audioFields = { noise: [0, 0, 18, 1], fadeIn: [0, 0, 3, .1], fadeOut: [0, 0, 3, .1] } as const
const presets = { neutral: { brightness: 0, contrast: 1, saturation: 1, sharpness: 0 },
  vivid: { brightness: .015, contrast: 1.11, saturation: 1.16, sharpness: .2 },
  soft: { brightness: .02, contrast: .92, saturation: .85, sharpness: .05 } } as const

export function EffectsPanel({ copy, audio, file, range, edit, cues, effects, update, undo, compare, setCompare, pause }: Props) {
  const [preview, setPreview] = useState<{ url: string; original: boolean }>()
  const [progress, setProgress] = useState<number>()
  const [error, setError] = useState('')
  const operation = useRef<{ controller: AbortController; id?: string }>(null)
  const [suggested, setSuggested] = useState<StudioEffects['zoom']>()
  useEffect(() => () => {
    const current = operation.current
    current?.controller.abort()
    if (current?.id) void localExporter.release(current.id)
  }, [])

  async function monitor(original: boolean) {
    if (!file) return
    pause()
    const previous = operation.current
    previous?.controller.abort()
    const next: { controller: AbortController; id?: string } = { controller: new AbortController() }
    operation.current = next
    setPreview(undefined); setProgress(0); setError('')
    const signal = next.controller.signal
    try {
      if (previous?.id) await localExporter.release(previous.id)
      signal.throwIfAborted()
      const part = { start: range.start, end: Math.min(range.end, range.start + 8) }
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted()
        try {
          next.id = (await localExporter.create(file, part, undefined, audio ? undefined : edit,
            { resolution: 720, fps: 30, quality: 'balanced', bitrate: 0 }, original ? undefined : effects, true)).id
          break
        } catch (reason) {
          if (!(reason instanceof ExportClientError && reason.code === 'busy') || attempt === 4) throw reason
          await new Promise(resolve => setTimeout(resolve, 180))
        }
      }
      signal.throwIfAborted()
      await localExporter.upload(next.id, file, signal, setProgress)
      while (!signal.aborted) {
        const job = await localExporter.status(next.id, signal)
        if (job.phase === 'failed') throw new ExportClientError(job.error ?? 'encodeFailed')
        if (job.phase === 'ready') { setPreview({ url: localExporter.monitorUrl(next.id), original }); return }
        setProgress(job.progress)
        await new Promise(resolve => setTimeout(resolve, 220))
      }
    } catch (reason) {
      if (!signal.aborted) setError(copy.exportErrors[reason instanceof ExportClientError ? reason.code : 'serviceError'])
    } finally {
      if (operation.current === next) setProgress(undefined)
      if ((signal.aborted || operation.current !== next) && next.id) await localExporter.release(next.id)
    }
  }

  function closeMonitor() {
    const current = operation.current
    current?.controller.abort()
    if (current?.id) void localExporter.release(current.id)
    operation.current = null; setProgress(undefined); setPreview(undefined)
  }

  const change = (value: Partial<StudioEffects>) => {
    if (operation.current) closeMonitor()
    update({ ...effects, ...value, zoomReturn: Object.hasOwn(value, 'zoom') ? undefined : effects?.zoomReturn })
  }
  const zoom = effects?.zoom
  const usable = !!file && range.end - range.start >= .15
  return <section className="panel v9-effects" aria-label={audio ? copy.fxAudio : copy.fxVideo}>
    <header className="panel-header"><h2>{audio ? copy.fxAudio : copy.fxVideo}</h2></header>
    <div className="auto-shorts-body">
      {!audio && <>
        <div className="shorts-actions">{Object.entries(presets).map(([name, value]) => <button className="export-cancel" key={name}
          onClick={() => change(value)}>{copy.fxPresets[name as keyof Copy['fxPresets']]}</button>)}</div>
        <label><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)} /> {copy.fxBefore}</label>
      </>}
      {(Object.entries(audio ? audioFields : colorFields) as [keyof StudioEffects & keyof Copy['fxFields'], readonly number[]][]).map(([key, [value, min, max, step]]) =>
        <label key={key} className="fx-control">{copy.fxFields[key]} <output>{String(effects?.[key] ?? value)}</output>
          <input type="range" min={min} max={max} step={step} defaultValue={value} key={String(effects?.[key] ?? value)}
            ref={node => { if (node) node.value = String(effects?.[key] ?? value) }}
            onPointerUp={event => change({ [key]: Number(event.currentTarget.value) })}
            onKeyUp={event => { if (event.key.startsWith('Arrow') || ['Home', 'End'].includes(event.key)) change({ [key]: Number(event.currentTarget.value) }) }} />
        </label>)}
      {audio ? <>{(['voice', 'normalize'] as const).map(key => <label key={key}><input type="checkbox" checked={!!effects?.[key]}
        onChange={event => change({ [key]: event.target.checked })} /> {copy.fxFields[key]}</label>)}</> : <>
        <div className="shorts-actions">
          <button className="export-cancel" disabled={!usable} onClick={() => change({ zoom: { start: range.start,
            end: Math.min(range.end, range.start + 2), from: 1, to: 1.18 } })}>{copy.fxZoomIn}</button>
          <button className="export-cancel" disabled={!usable} onClick={() => change({ zoom: { start: range.start,
            end: Math.min(range.end, range.start + 2), from: 1.18, to: 1 } })}>{copy.fxZoomOut}</button>
          <button className="export-cancel" disabled={!usable || !cues.length} onClick={() => {
            const result = suggestZoom(cues, range); setSuggested(result); setError(result ? '' : copy.fxNoZoom)
          }}>{copy.fxSuggest}</button>
          {suggested && <button className="primary" onClick={() => { change({ zoom: suggested }); setSuggested(undefined) }}>{copy.fxApprove}</button>}
        </div>
        {suggested && <p>{suggested.start.toFixed(2)}–{suggested.end.toFixed(2)} {copy.seconds} · 1× → 1.14×</p>}
        {zoom && <div className="auto-settings">{(['start', 'end', 'from', 'to'] as const).map(key => <label key={key}>
          {key === 'start' || key === 'end' ? copy[key] : copy.fxFields[key]}
          <input type="number" step=".01" key={zoom[key]} defaultValue={zoom[key]} onBlur={event => {
            const value = Number(event.target.value), next = { ...zoom, [key]: value }
            if (!event.target.value || !Number.isFinite(value) || next.start < 0 || next.end - next.start < .1 ||
                [next.from, next.to].some(x => x < 1 || x > 1.65)) { event.target.value = String(zoom[key]); return }
            change({ zoom: next })
          }} /></label>)}<button className="export-cancel" onClick={() => change({ zoom: undefined, zoomReturn: undefined })}>{copy.fxClearZoom}</button></div>}
      </>}
      <div className="shorts-actions"><button className="export-cancel" onClick={() => { closeMonitor(); undo() }}>{copy.undo}</button>
        <button className="export-cancel" onClick={() => { closeMonitor(); update(undefined) }}>{copy.reset}</button></div>
      {!!window.viralCutDesktop && <>
        <div className="shorts-actions">
          <button className="export-cancel" disabled={!usable || progress !== undefined} onClick={() => void monitor(true)}>{copy.fxListenOriginal}</button>
          <button className="export-cancel" disabled={!usable || progress !== undefined} onClick={() => void monitor(false)}>{copy.fxListenProcessed}</button>
          {(progress !== undefined || preview || operation.current) && <button className="export-cancel" onClick={closeMonitor}>{copy.close}</button>}
        </div>
        {progress !== undefined && <progress aria-label={copy.fxListenProcessed} max="100" value={progress} />}
        {preview && <video className={audio ? 'fx-monitor fx-monitor-audio' : 'fx-monitor'} src={preview.url} controls autoPlay onError={() => setError(copy.exportErrors.encodeFailed)} />}
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
  </section>
}
