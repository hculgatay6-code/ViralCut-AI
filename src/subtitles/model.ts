export interface Cue {
  start: number
  end: number
  text: string
  words?: { start: number; end: number; text: string }[]
}

export interface Appearance {
  style: 'classic' | 'bold' | 'box'
  font: 'arial' | 'segoe' | 'verdana'
  size: number
  position: 'top' | 'middle' | 'bottom'
  textColor: string
  highlightColor: string
  backgroundColor: string
  highlight: boolean
  motion?: 'none' | 'fade' | 'pop' | 'drop' | 'bounce'
  highlightMode?: 'word' | 'karaoke' | 'speech' | 'keywords'
  speed?: number
  outline?: number
  outlineColor?: string
  secondaryColor?: string
  shadow?: number
  safe?: boolean
  y?: number
}

export interface Overlay { cues: Cue[]; appearance: Appearance }
export interface Transcript { cues: Cue[]; languages: string[]; backend: string }

export const stylePresets = {
  classic: { size: 52, textColor: '#ffffff', backgroundColor: '#151515' },
  bold: { size: 64, textColor: '#f4ff92', backgroundColor: '#191b0b' },
  box: { size: 52, textColor: '#ffffff', backgroundColor: '#181818' },
}

export const defaultAppearance: Appearance = {
  ...stylePresets.classic, style: 'classic', font: 'arial', position: 'bottom',
  highlightColor: '#b7fa70', highlight: true,
}
