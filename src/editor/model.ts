export interface VideoMetadata {
  duration: number
  width: number
  height: number
}

export interface ClipRange {
  start: number
  end: number
}

export const subtitleStyles = ['classic', 'bold', 'box'] as const
export type SubtitleStyle = (typeof subtitleStyles)[number]

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// Milliseconds keep the timeline and the trim fields on the same timebase.
export function timecode(seconds: number, showMillis = true) {
  const total = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(total / 3600000)
  const minutes = Math.floor(total / 60000) % 60
  const wholeSeconds = Math.floor(total / 1000) % 60
  const millis = total % 1000
  const clock = [hours, minutes, wholeSeconds].map(value => String(value).padStart(2, '0')).join(':')
  return showMillis ? clock + '.' + String(millis).padStart(3, '0') : clock
}

export function sizeLabel(bytes: number, locale: string) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = bytes === 0 ? 0 : Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return new Intl.NumberFormat(locale, { maximumFractionDigits: index ? 1 : 0 }).format(value) + ' ' + units[index]
}
