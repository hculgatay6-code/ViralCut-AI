import type { Appearance, Cue } from '../src/subtitles/model'
export const motions: readonly ['none', 'fade', 'pop', 'drop', 'bounce']
export const highlights: readonly ['word', 'karaoke', 'speech', 'keywords']
export function hasReliableWords(cue: Cue): boolean
export function captionMotion(cue: Cue, design: Appearance, time: number, timed: boolean): { window: number; scale: number; offset: number; opacity: number }
export function captionParts(cue: Cue, design: Appearance, time: number, timed: boolean): { text: string; color?: string }[]
export function captionY(design: Appearance): number
