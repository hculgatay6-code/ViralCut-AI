import { effectDocument } from '../../server/effect-document.mjs'
import type { ClipEffect } from '../../server/effect-document.mjs'

type Recipe = [string,number,number]
export const presetGroups: [string,[string,string,Recipe[]][]][] = [
  ['Cinematic', [
    ['cinematic','Cinematic Glow',[['glow',.42,.35],['vignette',.58,.5]]],
    ['wide','Wide Screen',[['bars',1,.55],['vignette',.26,.45]]],
    ['matte','Matte Film',[['vintage',.55,.5],['grain',.36,.35]]],
    ['noir','Silver Noir',[['mono',1,.84],['vignette',.4,.6]]],
    ['warm','Amber Cinema',[['sepia',.48,.6],['bloom',.31,.32]]],
  ]],
  ['Social Media', [
    ['dream','Dream Blur',[['blur',.35,.5],['glow',.52,.6]]],
    ['soft','Soft Portrait',[['glow',.28,.25],['vignette',.24,.32]]],
    ['fresh','Clean Cut',[['sharpen',.38,.42],['vintage',.17,.64]]],
    ['pop','Color Pop',[['bloom',.38,.52],['sharpen',.45,.54]]],
    ['pixel','Pixel Portrait',[['pixel',.76,.35],['vignette',.23,.4]]],
  ]],
  ['Gaming', [
    ['gaming','Gaming RGB',[['rgb',.71,.5],['sharpen',.37,.5]]],
    ['neon','Neon Gaming',[['neon',.77,.65],['aberration',.27,.28]]],
    ['arena','Arena Motion',[['shake',.57,.57],['rgb',.3,.34]]],
    ['arcade','Arcade Tiles',[['poster',.44,.6],['pixel',.7,.73]]],
    ['onair','Signal Glitch',[['glitch',.67,.48],['noise',.27,.4]]],
  ]],
  ['Vlog', [
    ['vlog','Smooth Vlog',[['zoom',.67,.42],['glow',.22,.24]]],
    ['walk','Walking Shot',[['pan',.58,.3],['sharpen',.32,.43]]],
    ['daily','Daily Warmth',[['sepia',.18,.5],['glow',.27,.2]]],
    ['night','Night Light',[['bloom',.44,.55],['vignette',.23,.5]]],
    ['detail','Fine Detail',[['sharpen',.66,.65],['aberration',.13,.3]]],
  ]],
  ['Retro', [
    ['oldfilm','Vintage Film',[['retro',.72,.47],['vignette',.38,.56]]],
    ['vhs','Retro VHS',[['vhs',.7,.58],['noise',.24,.36]]],
    ['postcard','Old Postcard',[['sepia',.72,.68],['grain',.31,.42]]],
    ['analog','Analog Lens',[['lens',.54,.29],['aberration',.37,.28]]],
    ['news','Archive News',[['mono',1,.57],['noise',.25,.34]]],
  ]],
  ['Music Video', [
    ['bass','Bass Pulse',[['pulse',.73,.52],['neon',.36,.64]]],
    ['edge','Electric Edges',[['edge',.55,.44],['rgb',.44,.57]]],
    ['metal','Metal Relief',[['emboss',.56,.45],['mono',.63,.68]]],
    ['laser','Laser Glitch',[['glitch',.8,.72],['aberration',.65,.45]]],
    ['club','Club Bloom',[['bloom',.6,.63],['pan',.44,.55]]],
  ]],
  ['Shorts & Reels', [
    ['shorts','Dynamic Shorts',[['pulse',.63,.59],['sharpen',.45,.55]]],
    ['action','Fast Action',[['shake',.74,.69],['directional',.4,.51]]],
    ['mosaic','Mosaic Beat',[['mosaic',.63,.5],['poster',.33,.5]]],
    ['spark','Glow Cut',[['glow',.68,.6],['lens',.25,.25]]],
    ['reel','Clean Reel',[['vintage',.26,.6],['sharpen',.35,.38]]],
  ]],
]
export function effectPreset(id:string,length:number): ClipEffect[] {
  const recipe=presetGroups.flatMap(([,items])=>items).find(([name])=>name===id)?.[2] ?? []
  return recipe.map(([id,amount,detail])=>({id,amount,detail,start:0,end:length,enabled:true}))
}

export function importPreset(text:string,length:number): ClipEffect[] {
  if (text.length>100000) throw Error('badEffects')
  const data=JSON.parse(text)
  if(data?.version!==1 || !Number.isSafeInteger(data.length) || data.length<1 || data.length>5184000) throw Error('badEffects')
  const original=effectDocument(data.effects,data.length)
  if(!original?.length) throw Error('badEffects')
  const ratio=length/data.length
  const next=original.map(effect=>{
    const start=Math.min(length-1,Math.round(effect.start*ratio))
    const end=Math.max(start+1,Math.min(length,Math.round(effect.end*ratio)))
    const keys=effect.keys?.map(point=>({...point,frame:Math.min(end-start-1,Math.round(point.frame*ratio))}))
    return {...effect,start,end,...(keys?{keys:[...new Map(keys.map(point=>[point.frame,point])).values()]}:{})}
  })
  return effectDocument(next,length)!
}
