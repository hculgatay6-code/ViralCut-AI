import { useRef } from 'react'

export function StudioDivider({ name, axis, value, min, max, resize, invert = false }: {
  name: string; axis: 'width' | 'height'; value: number; min: number; max: number
  resize: (value: number) => void; invert?: boolean
}) {
  const drag = useRef<{ origin: number; value: number } | null>(null)
  const direction = invert ? -1 : 1
  const adjust = (next: number) => resize(Math.round(Math.min(max, Math.max(min, next))))
  return <div role="separator" tabIndex={0} aria-label={name} aria-orientation={axis === 'width' ? 'vertical' : 'horizontal'}
    aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} className={'studio-divider ' + axis}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { value, origin: axis === 'width' ? event.clientX : event.clientY }
    }}
    onPointerMove={event => {
      if (!drag.current) return
      const coordinate = axis === 'width' ? event.clientX : event.clientY
      adjust(drag.current.value + (coordinate - drag.current.origin) * direction)
    }} onLostPointerCapture={() => { drag.current = null }}
    onKeyDown={event => {
      const delta = axis === 'width' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 }
      const step = delta[event.key as keyof typeof delta]
      if (step === undefined) return
      event.preventDefault()
      adjust(value + step * 16 * direction)
    }} />
}
