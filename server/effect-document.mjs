import { keyframeDocument, sliceAnimation } from './keyframes.mjs'

export const effects = [
  ['blur','visual','Gaussian blur','Gauss bulanıklığı'],
  ['directional','visual','Directional blur','Yönlü bulanıklık'],
  ['sharpen','visual','Sharpen','Keskinlik'],
  ['glow','visual','Glow','Işıma'],
  ['bloom','visual','Bloom','Parlak alan ışıması'],
  ['vignette','visual','Vignette','Kenar karartma'],
  ['grain','visual','Film grain','Film greni'],
  ['noise','visual','Noise','Gürültü'],
  ['aberration','visual','Chromatic aberration','Renk sapması'],
  ['lens','visual','Lens distortion','Mercek bozulması'],
  ['rgb','visual','RGB split','RGB ayırma'],
  ['pixel','visual','Pixelate','Pikselleştir'],
  ['mosaic','visual','Coarse mosaic','İri mozaik'],
  ['edge','visual','Edge detection','Kenar algılama'],
  ['emboss','visual','Emboss','Kabartma'],
  ['poster','visual','Posterize','Renk basamakları'],
  ['shake','motion','Camera shake','Kamera sarsıntısı'],
  ['zoom','motion','Smooth zoom','Yumuşak yakınlaşma'],
  ['pulse','motion','Zoom pulse','Yakınlaşma darbesi'],
  ['pan','motion','Dynamic pan','Dinamik kaydırma'],
  ['vhs','style','VHS color bleed','VHS renk taşması'],
  ['retro','style','Retro film','Retro film'],
  ['bars','style','Cinematic bars','Sinematik şeritler'],
  ['mono','style','Black & white','Siyah beyaz'],
  ['sepia','style','Sepia','Sepya'],
  ['vintage','style','Vintage','Nostaljik'],
  ['neon','style','Neon edges','Neon kenarlar'],
  ['glitch','style','Digital glitch','Dijital bozulma'],
]
export const transitions = [
  ['dissolve','Cross dissolve','Çapraz çözünme'],
  ['fade','Fade through lower layers','Alt katman üzerinden solma'],
  ['black','Dip to black','Siyaha geç'],
  ['white','Dip to white','Beyaza geç'],
  ['wipe','Wipe','Silme'],
  ['slide','Slide','Kaydırma'],
  ['push','Push','İtme'],
  ['pixel','Pixel reveal','Piksel geçişi'],
  ['flash','Flash','Flaş'],
]
export const directions = ['left','right','up','down']
export const maxEffects = 8
const ids = new Set(effects.map(([id]) => id))
const transitionsById = new Set(transitions.map(([id]) => id))
const strength = value => Number.isFinite(value) && value >= 0 && value <= 1
const bounded = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high
function invalid() { throw Error('badEffects') }

export function effectDocument(stack, length) {
  if (stack === undefined) return undefined
  if (!Array.isArray(stack) || stack.length > maxEffects) invalid()
  return stack.map(entry => {
    if (!entry || !ids.has(entry.id) || !strength(entry.amount) || !strength(entry.detail) ||
        typeof entry.enabled !== 'boolean' || !bounded(entry.start,0,length-1) || !bounded(entry.end,entry.start+1,length)) invalid()
    const { id, amount, detail, enabled, start, end } = entry
    const points = entry.keys === undefined ? undefined : keyframeDocument({ opacity:entry.keys },'video',end-start)?.opacity
    if (points && points.length > 32) invalid()
    return { id, amount, detail, enabled, start, end, ...(points ? {keys:points} : {}) }
  })
}

export function transitionDocument(value, length, fps) {
  if (value === undefined) return undefined
  if (!value || !transitionsById.has(value.id) || !directions.includes(value.direction) || !strength(value.amount) ||
      !bounded(value.start,0,length-2) || !bounded(value.length,2,Math.min(4*fps,length-value.start))) invalid()
  const { id,direction,amount,start,length:duration }=value
  return { id,direction,amount,start,length:duration }
}

export function sliceEffects(stack, offset, length) {
  return stack?.flatMap(effect => {
    const start=Math.max(0,effect.start-offset), end=Math.min(length,effect.end-offset)
    if (end<=start) return []
    const keys=sliceAnimation(effect.keys ? {opacity:effect.keys} : undefined,offset+start-effect.start,end-start)?.opacity
    return [{ ...effect,start,end,...(keys ? {keys} : {}) }]
  })
}

export function libraryDocument(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.favorites) || input.favorites.length>effects.length ||
      !input.favorites.every(id=>ids.has(id)) || !input.names || typeof input.names !== 'object' || Array.isArray(input.names)) invalid()
  const entries=Object.entries(input.names)
  if (entries.length>16) invalid()
  const names=Object.fromEntries(entries.map(([name,raw])=>{
    if (!name.trim() || name.length>45 || typeof raw!=='string' || raw.length>100000) invalid()
    const data=JSON.parse(raw)
    if (data?.version!==1 || !bounded(data.length,1,5184000)) invalid()
    const stack=effectDocument(data.effects,data.length)
    if (!stack?.length) invalid()
    return [name,JSON.stringify({version:1,length:data.length,effects:stack})]
  }))
  return {names,favorites:[...new Set(input.favorites)]}
}
