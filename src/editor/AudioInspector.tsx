import { useEffect, useRef, useState } from 'react'
import type { Copy, Language } from '../i18n'
import { ExportClientError, localExporter } from '../export/client'
import type { AudioReport } from '../export/client'
import type { ClipRange } from './model'
import type { StudioEffects } from './effects'

type Operation = { controller: AbortController; id?: string }

export function AudioInspector({ id, range, copy, language, effects, update }: {
  id?: string; range: ClipRange; copy: Copy; language: Language
  effects?: StudioEffects; update: (effects?: StudioEffects) => void
}) {
  const [report, setReport] = useState<AudioReport>()
  const [progress, setProgress] = useState<number>()
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const operation = useRef<Operation | null>(null)
  const tr = language === 'tr'
  const text = (turkish: string, english: string) => tr ? turkish : english

  function stop() {
    const active = operation.current
    if (!active) return
    active.controller.abort()
    if (active.id) void localExporter.release(active.id)
  }
  useEffect(() => {
    setReport(undefined)
    setMessage('')
    return stop
  }, [id, range.start, range.end])

  async function analyze() {
    if (!id || operation.current) return
    const active: Operation = { controller: new AbortController() }
    operation.current = active
    const signal = active.controller.signal
    setReport(undefined); setMessage(''); setProgress(0); setFailed(false)
    try {
      active.id = (await localExporter.analyzeAudio(id, range)).id
      for (;;) {
        signal.throwIfAborted()
        const status = await localExporter.status(active.id, signal)
        if (status.phase === 'ready') {
          const result = await localExporter.audioReport(active.id, signal)
          signal.throwIfAborted()
          setReport(result)
          break
        }
        if (status.phase === 'failed') throw new ExportClientError(status.error ?? 'encodeFailed')
        setProgress(status.progress)
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    } catch (error) {
      setFailed(!signal.aborted)
      setMessage(signal.aborted ? copy.exportCancelled : copy.exportErrors[error instanceof ExportClientError ? error.code : 'serviceError'])
    } finally {
      if (active.id) await localExporter.release(active.id)
      operation.current = null
      setProgress(undefined)
    }
  }
  const { noise: _noise, normalize: _normalize, voice: _voice, fadeIn: _fadeIn, fadeOut: _fadeOut, ...picture } = effects ?? {}
  const unit = (value: number | null, suffix: string) => value === null ? '—' : value.toFixed(1) + ' ' + suffix
  return <section className="panel" aria-label={text('Ses Stüdyosu', 'Audio Studio')}>
    <header className="panel-header"><h2>{text('Ses Stüdyosu', 'Audio Studio')}</h2></header>
    <div className="auto-shorts-body">
      <div className="shorts-actions">
        <button className="export-cancel" disabled={!id || progress !== undefined || range.end - range.start < .1}
          onClick={() => void analyze()}>{text('Seçili aralıkta ses ölç', 'Measure selected audio range')}</button>
        {progress !== undefined && <button className="export-cancel" onClick={stop}>{copy.exportCancel}</button>}
      </div>
      {progress !== undefined && <progress aria-label={text('Ses analizi', 'Audio analysis')} max={100} value={progress} />}
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
      {report && <>
        <dl className="performance-metrics">
          <div><dt>{text('Ses yüksekliği', 'Integrated loudness')}</dt><dd>{unit(report.integrated, 'LUFS')}</dd></div>
          <div><dt>{text('Gerçek tepe', 'True peak')}</dt><dd>{unit(report.peak, 'dBTP')}</dd></div>
          <div><dt>{text('Dinamik aralık', 'Loudness range')}</dt><dd>{unit(report.range, 'LU')}</dd></div>
          <div><dt>{text('Ses/görüntü başlangıç farkı', 'Audio/video stream start offset')}</dt>
            <dd>{report.streamDeltaMs === null ? '—' : report.streamDeltaMs + ' ms'}</dd></div>
        </dl>
        {report.peak !== null && report.peak > -1 && <p role="status">{report.peak >= -.1
          ? text('Tepe 0 dBTP’ye yakın veya üzerinde. Kırpılma riski var.', 'Peaks approach or exceed 0 dBTP. Clipping is possible.')
          : text('Ses tepeleri yüksek.', 'Audio peaks are high.')}</p>}
      </>}
      {id && <div className="shorts-actions">
        <button className="export-cancel" onClick={() => update({ ...effects, normalize: true, voice: true })}>
          {text('Konuşmayı dengele', 'Balance speech')}</button>
        <button className="export-cancel" disabled={!effects} onClick={() => update(Object.keys(picture).length ? picture : undefined)}>
          {text('Özgün sesi geri yükle', 'Restore original audio')}</button>
      </div>}
    </div>
  </section>
}
