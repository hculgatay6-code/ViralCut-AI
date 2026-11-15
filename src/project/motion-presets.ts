import { keyframeBounds } from '../../server/keyframes.mjs'
import type { Animation, Curve, Parameter } from '../../server/keyframes.mjs'

type Motion = { en: string; tr: string; parameter: Parameter; values: number[]; curve: Curve; offset?: boolean }
export const motionPresets: Motion[] = [
  { en:'Fade in', tr:'Belirerek açıl', parameter:'opacity', values:[0,1], curve:'ease-out' },
  { en:'Fade out', tr:'Solup kapan', parameter:'opacity', values:[1,0], curve:'ease-in' },
  { en:'Zoom in', tr:'Yakınlaş', parameter:'scale', values:[-.35,0], curve:'linear', offset:true },
  { en:'Zoom out', tr:'Uzaklaş', parameter:'scale', values:[.35,0], curve:'linear', offset:true },
  { en:'Slide left', tr:'Sola kay', parameter:'x', values:[.5,0], curve:'ease-out', offset:true },
  { en:'Slide right', tr:'Sağa kay', parameter:'x', values:[-.5,0], curve:'ease-out', offset:true },
  { en:'Slide up', tr:'Yukarı kay', parameter:'y', values:[.5,0], curve:'ease-out', offset:true },
  { en:'Slide down', tr:'Aşağı kay', parameter:'y', values:[-.5,0], curve:'ease-out', offset:true },
  { en:'Bounce', tr:'Zıpla', parameter:'y', values:[.3,-.16,.07,-.025,0], curve:'ease-out', offset:true },
  { en:'Pop', tr:'Belirip büyü', parameter:'scale', values:[-.65,.14,-.04,0], curve:'ease-out', offset:true },
  { en:'Shake', tr:'Titret', parameter:'x', values:[0,-.14,.12,-.09,.06,-.03,0], curve:'linear', offset:true },
  { en:'Smooth pan right', tr:'Yumuşak sağ tarama', parameter:'x', values:[-.35,.35], curve:'ease-in-out', offset:true },
  { en:'Smooth pan left', tr:'Yumuşak sol tarama', parameter:'x', values:[.35,-.35], curve:'ease-in-out', offset:true },
  { en:'Smooth zoom', tr:'Yumuşak yakınlaşma', parameter:'scale', values:[0,.32], curve:'ease-in-out', offset:true },
  { en:'Rotate in', tr:'Dönerek gir', parameter:'rotation', values:[-35,0], curve:'ease-out', offset:true },
  { en:'Rotate out', tr:'Dönerek çık', parameter:'rotation', values:[0,35], curve:'ease-in', offset:true },
  { en:'Scale pulse', tr:'Ölçek darbesi', parameter:'scale', values:[0,.23,0], curve:'ease-in-out', offset:true },
  { en:'Breathe', tr:'Hafif ölçek salınımı', parameter:'scale', values:[0,.08,0,.08,0], curve:'ease-in-out', offset:true },
  { en:'Float', tr:'Dikey süzül', parameter:'y', values:[.10,-.10,.10], curve:'ease-in-out', offset:true },
  { en:'Tilt', tr:'Eğ ve düzelt', parameter:'rotation', values:[0,12,-10,0], curve:'ease-in-out', offset:true },
  { en:'Text reveal', tr:'Metni aşamalı göster', parameter:'reveal', values:[0,1], curve:'linear' },
  { en:'Audio fade in', tr:'Sesi yükselterek başlat', parameter:'volume', values:[0,1], curve:'ease-in' },
  { en:'Audio fade out', tr:'Sesi azaltarak bitir', parameter:'volume', values:[1,0], curve:'ease-out' },
]

export function presetAnimation(preset: Motion, current: number, start: number, duration: number, intensity: number): Animation {
  const [min,max] = keyframeBounds[preset.parameter]
  const points = new Map(preset.values.map((value, index) => {
    const frame = start + Math.round(duration * index / (preset.values.length - 1))
    const target = preset.offset ? current + value * intensity : current + (value - current) * intensity
    return [frame, { frame, value: Math.max(min,Math.min(max,target)), curve:preset.curve }]
  }))
  return { [preset.parameter]: [...points.values()] }
}
