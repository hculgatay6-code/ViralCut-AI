import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { Film, RotateCcw, Scissors, Timer } from 'lucide-react'
import type { Copy } from '../i18n'
import { timecode } from './model'
import type { ClipRange } from './model'
import type { VideoEditor } from './useVideo'
import type { Cue } from '../subtitles/model'

interface Props {
  editor: VideoEditor
  copy: Copy
  cues?: Cue[]
  silence?: ClipRange[]
  removals?: ClipRange[]
}

function BoundaryField({ editor, copy, boundary }: Props & { boundary: keyof ClipRange }) {
  const [draft, setDraft] = useState<string | null>(null)
  const label = copy[boundary]
  const seconds = editor.range[boundary]
  const markLabel = boundary === 'start' ? copy.setStart : copy.setEnd

  return (
    <div className="boundary">
      <label htmlFor={boundary + '-seconds'}>{label}</label>
      <div className="boundary-input">
        <input
          id={boundary + '-seconds'}
          type="text"
          inputMode="decimal"
          aria-label={label + ' (' + copy.seconds + ')'}
          disabled={!editor.metadata}
          value={editor.metadata ? (draft ?? String(seconds)) : '—'}
          onChange={event => setDraft(event.target.value)}
          onBlur={() => {
            if (draft === null) return
            setDraft(null)
            const value = draft.trim()
            editor.setBoundary(boundary, /^\d+(?:[.,]\d+)?$/.test(value) ? Number(value.replace(',', '.')) : NaN)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setDraft(null)
          }}
        />
        <span>{copy.seconds}</span>
        <button type="button" aria-label={markLabel} title={markLabel} disabled={!editor.metadata}
          onClick={() => editor.setBoundary(boundary, editor.element.current?.currentTime ?? editor.time)}>
          <Scissors size={14} />
        </button>
      </div>
    </div>
  )
}

export function Timeline({ editor, copy, cues = [], silence = [], removals = [] }: Props) {
  const { metadata, range, time, source, seek, setBoundary } = editor
  const duration = metadata?.duration ?? 0
  const percent = (value: number) => duration ? 100 * value / duration + '%' : '0%'
  const canvas = useRef<HTMLDivElement>(null)
  const markers = cues.length <= 300 ? cues : Array.from({ length: 300 }, (_, index) => cues[Math.floor(index * cues.length / 300)])
  const timelineStyle = {
    '--head': percent(time),
    '--clip-left': percent(range.start),
    '--clip-right': duration ? 100 - 100 * range.end / duration + '%' : '0%',
  } as CSSProperties

  function dragBoundary(event: PointerEvent<HTMLDivElement>, boundary: keyof ClipRange) {
    const bounds = canvas.current?.getBoundingClientRect()
    if (!bounds?.width) return
    setBoundary(boundary, Math.round((event.clientX - bounds.left) / bounds.width * duration * 1000) / 1000, true)
  }

  return (
    <section className="panel timeline" aria-labelledby="timeline-heading">
      <header className="panel-header timeline-header">
        <h2 id="timeline-heading"><Timer size={17} />{copy.timeline}</h2>
        <div className="timeline-tools">
          <BoundaryField key={(source?.url ?? '') + 'start'} editor={editor} copy={copy} boundary="start" />
          <BoundaryField key={(source?.url ?? '') + 'end'} editor={editor} copy={copy} boundary="end" />
          <button type="button" className="reset-button" disabled={!metadata} onClick={editor.resetRange}>
            <RotateCcw size={13} />{copy.reset}
          </button>
        </div>
      </header>
      <div className="timeline-grid">
        <div className="track-labels">
          <div className="track-label"><Film size={16} />{copy.videoTrack}</div>
          {cues.length > 0 && <div className="caption-track-label">CC</div>}
          {silence.length > 0 && <div className="caption-track-label">dB</div>}
        </div>
        <div className="timeline-canvas" ref={canvas} style={timelineStyle}>
          <div className="ruler">
            <div className="ruler-labels" aria-hidden="true">
              {(metadata ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0]).map(step => (
                <span key={step}>{timecode(duration * step / 8, false).slice(duration < 3600 ? 3 : 0)}</span>
              ))}
            </div>
            <input type="range" className="seek-input" aria-label={copy.seek}
              aria-valuetext={timecode(time)} min={0} max={duration || 1} step="any"
              disabled={!metadata} value={time} onChange={event => seek(Number(event.target.value))}
              onKeyDown={event => {
                if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault()
                  seek(event.key === 'Home' ? 0 : duration)
                  return
                }
                if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) return
                event.preventDefault()
                const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                seek(time + (backwards ? -1 : 1) * (event.shiftKey ? 5 : 1))
              }} />
          </div>
          <div className="track">
            {metadata ? <>
              <div className="clip">
                <Film size={14} /><span title={source?.file.name}>{source?.file.name}</span>
              </div>
              <div className="clip-selection" aria-hidden="true" />
              <div className="trim-handles" aria-hidden="true">
                {(['start', 'end'] as const).map(boundary => (
                  <div key={boundary} className={'trim-handle ' + boundary}
                    title={copy[boundary]}
                    onPointerDown={event => {
                      if (event.button !== 0) return
                      event.currentTarget.setPointerCapture(event.pointerId)
                    }}
                    onPointerMove={event => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) dragBoundary(event, boundary)
                    }} />
                ))}
              </div>
            </> : <div className="track-empty">{copy.trackEmpty}</div>}
          </div>
          {cues.length > 0 && <div className="caption-track" aria-label={copy.aiSubtitles}>
            {markers.map((cue, index) => <button key={index} type="button" title={cue.text || copy.addSubtitle}
              aria-label={(cue.text || copy.addSubtitle) + ' · ' + timecode(cue.start)}
              style={{ left: percent(cue.start), width: percent(cue.end - cue.start) }}
              onClick={() => seek(cue.start)}>{cue.text}</button>)}
          </div>}
          {silence.length > 0 && <div className="silence-track" aria-label={copy.silenceTrack}>
            {silence.slice(0, 500).map(span => <span key={span.start} title={timecode(span.start) + ' – ' + timecode(span.end)}
              style={{ left: percent(span.start), width: percent(span.end - span.start) }} />)}
            {removals.map(span => <span className="removed" key={span.start}
              style={{ left: percent(span.start), width: percent(span.end - span.start) }} />)}
          </div>}
          <div className="playhead" aria-hidden="true"><span /></div>
        </div>
      </div>
      <footer className="timeline-footer">
        <span>{copy.selection} <b>{metadata ? timecode(range.end - range.start) : '—'}</b></span>
        <span className="shortcut"><kbd>{copy.space}</kbd>{copy.shortcut}</span>
      </footer>
    </section>
  )
}
