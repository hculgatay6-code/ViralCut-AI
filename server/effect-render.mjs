import { keyframeValue } from './keyframes.mjs'

const n = value => Number(value.toFixed(6))
const i = value => Math.round(value)

const filtersById = {
  blur: d => `gblur=sigma=${n(1+d*15)}`,
  directional: d => `gblur=sigma=${n(2+d*22)}:sigmaV=0.35`,
  sharpen: d => `unsharp=5:5:${n(.45+d*2)}`,
  glow: d => `gblur=sigma=${n(1+d*7)},eq=brightness=0.08:saturation=1.22`,
  bloom: d => `gblur=sigma=${n(2+d*13)},curves=all='0/0 .48/.50 .7/.91 1/1'`,
  vignette: d => `vignette=angle=${n(.22+d*.95)}`,
  grain: d => `noise=alls=${i(10+d*32)}:allf=u:all_seed=191`,
  noise: d => `noise=alls=${i(24+d*62)}:all_seed=37`,
  aberration: d => `rgbashift=rh=${i(1+d*16)}:bv=${-i(1+d*9)}:edge=smear`,
  lens: d => `lenscorrection=k1=${n(.09+d*.42)}:k2=-0.07`,
  rgb: d => `rgbashift=rh=${i(4+d*28)}:bh=${-i(4+d*28)}:edge=smear`,
  pixel: d => `pixelize=w=${i(4+d*24)}:h=${i(4+d*24)}`,
  mosaic: d => `pixelize=w=${i(16+d*64)}:h=${i(9+d*40)}:mode=max`,
  edge: d => `edgedetect=low=0.05:high=${n(.12+d*.38)}:mode=colormix`,
  emboss: d => `convolution='-2 -1 0 -1 1 1 0 1 2':'0 0 0 0 1 0 0 0 0':'0 0 0 0 1 0 0 0 0':'0 0 0 0 1 0 0 0 0',eq=brightness=${n(d*.16)}`,
  poster: d => `lutyuv=y='floor(val/${i(8+d*56)})*${i(8+d*56)}'`,
  vhs: d => `gblur=sigma=${n(.4+d*2)}:sigmaV=.2,rgbashift=rh=4:bh=-6,eq=saturation=1.26:contrast=.95`,
  retro: d => `curves=preset=vintage,noise=alls=${i(8+d*26)}:allf=u:all_seed=89`,
  bars: d => `drawbox=x=0:y=0:w=iw:h=ih*${n(.05+d*.13)}:c=black:t=fill,drawbox=x=0:y=ih-ih*${n(.05+d*.13)}:w=iw:h=ih*${n(.05+d*.13)}:c=black:t=fill`,
  mono: d => `hue=s=0,eq=contrast=${n(.85+d*.32)}`,
  sepia: d => `colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,eq=contrast=${n(.9+d*.2)}`,
  vintage: d => `curves=preset=cross_process,eq=saturation=${n(.5+d*.45)}`,
  neon: d => `edgedetect=low=0.04:high=0.17:mode=colormix,eq=saturation=${n(1.5+d*2.5)}`,
  glitch: d => `rgbashift=rh=${i(6+d*35)}:bv=${i(2+d*12)},pixelize=w=22:h=4:mode=min`,
}

function motion(id,d,clock) {
  const angle = `(${clock})*PI*2`
  const padding = n(.025+d*.12)
  const z = id === 'zoom' ? `1+${padding}*(.5-.5*cos(${angle}))`
    : id === 'pulse' ? `1+${padding}*(.5+.5*sin(2*${angle}))` : String(1+padding)
  const x = id === 'shake' ? `(iw-iw/zoom)*(.5+.46*sin(13*${angle}))`
    : id === 'pan' ? `(iw-iw/zoom)*(.5+.5*sin(${angle}))` : '(iw-iw/zoom)/2'
  const y = id === 'shake' ? `(ih-ih/zoom)*(.5+.46*cos(17*${angle}))` : '(ih-ih/zoom)/2'
  // Zoompan produces a fixed output and evaluates project time from the current window.
  return { z, x, y }
}

export function effectFilters(stack, label, width, height, fps, offset, count) {
  const filters=[], commands=[]
  let current=label+'base'
  for (const [index,effect] of (stack??[]).entries()) {
    if (!effect.enabled || (!effect.keys && !effect.amount) || offset>=effect.end || offset+count<=effect.start) continue
    const tag=label+'fx'+index
    const filter=filtersById[effect.id]?.(effect.detail)
    const clock=`(on+${offset-effect.start})/${Math.max(1,effect.end-effect.start-1)}`
    const move=filter ? null : motion(effect.id,effect.detail,clock)
    const chain=filter ?? `zoompan=z='${move.z}':x='${move.x}':y='${move.y}':d=1:s=${width}x${height}:fps=${fps}`
    const initial=keyframeValue(effect.keys,offset-effect.start,effect.amount)
    if (effect.keys?.length>1) {
      let previous = Number(n(initial))
      for (let i=1;i<count;i++) {
        const value=n(keyframeValue(effect.keys,offset+i-effect.start,effect.amount))
        if (value===previous) continue
        commands.push({frame:i,target:'blend@'+tag,value})
        previous=value
      }
    }
    filters.push(`[${current}]split[${tag}a][${tag}b];[${tag}b]${chain},format=yuv420p,setsar=1[${tag}fx];`+
      `[${tag}fx][${tag}a]blend@${tag}=all_mode=normal:all_opacity=${n(initial)}[${tag}out]`)
    current=tag+'out'
  }
  const script=commands.sort((a,b)=>a.frame-b.frame).map(({frame,target,value})=>`${Math.max(0,frame/fps-.000002).toFixed(9)} ${target} all_opacity ${value};`).join('\n')
  return {filters,current,script}
}

export function transitionMotion(spec, elapsed, fps, outgoing) {
  if (spec.id!=='slide' && spec.id!=='push' || outgoing && spec.id!=='push') return {}
  const p=`clip((round(t*${fps})+${elapsed})/${spec.length-1},0,1)`
  const eased=`(${p})*(1-${spec.amount})+(${p})*(${p})*(3-2*(${p}))*${spec.amount}`
  const axis=['left','right'].includes(spec.direction)?'x':'y'
  const size=axis==='x'?'W':'H'
  const sign=['left','up'].includes(spec.direction)?1:-1
  return {[axis]:`${size}*${sign}*(${outgoing?'0':'1'}-(${eased}))`}
}
export function transitionFilter(spec, elapsed, fps, old, fresh, output, lower) {
  const progress=`clip((round(T*${fps})+${elapsed})/${spec.length-1},0,1)`
  const geometry={left:'1-X/W',right:'X/W',up:'1-Y/H',down:'Y/H'}
  const coordinate=geometry[spec.direction]
  const easing=`(${progress})*(1-${spec.amount})+(${progress})*(${progress})*(3-2*(${progress}))*${spec.amount}`
  const feather=.004+spec.amount*.18
  let expression=`A*(1-ld(9))+B*ld(9)`
  if (spec.id==='wipe') expression=`st(8,clip((ld(9)*(1+${feather})-(${coordinate}))/${feather},0,1));A*(1-ld(8))+B*ld(8)`
  if (['slide','push'].includes(spec.id)) {
    const p=`(${progress})*(1-${spec.amount})+(${progress})*(${progress})*(3-2*(${progress}))*${spec.amount}`
    expression=`if(lte(${coordinate},${p}),B,A)`
  }
  if (spec.id==='fade') {
    const middle=output+'under'
    return `[${old}][${lower}]blend=all_expr='st(9,min(1,2*(${easing})));A*(1-ld(9))+B*ld(9)'[${middle}];[${middle}][${fresh}]blend=all_expr='st(9,max(0,2*(${easing})-1));A*(1-ld(9))+B*ld(9)'[${output}]`
  }
  if (spec.id==='pixel') expression=`if(lte(ld(9),0),A,if(lte(mod(floor(X/${i(4+spec.amount*22)})*31+floor(Y/${i(4+spec.amount*22)})*17,97)/97,ld(9)),B,A))`
  if (['black','white','flash'].includes(spec.id)) {
    const white=spec.id!=='black'
    const mix=spec.id==='flash' ? `pow(1-abs(2*ld(9)-1),4)*${spec.amount}` : `(1-abs(2*ld(9)-1))*${spec.amount}`
    const color=white ? 235 : 16
    return `[${old}][${fresh}]blend=c0_expr='st(9,${progress});st(8,${mix});(${expression})*(1-ld(8))+${color}*ld(8)':c1_expr='st(9,${progress});st(8,${mix});(${expression})*(1-ld(8))+128*ld(8)':c2_expr='st(9,${progress});st(8,${mix});(${expression})*(1-ld(8))+128*ld(8)'[${output}]`
  }
  return `[${old}][${fresh}]blend=all_expr='st(9,${spec.id==='dissolve' ? easing : progress});${expression}'[${output}]`
}
