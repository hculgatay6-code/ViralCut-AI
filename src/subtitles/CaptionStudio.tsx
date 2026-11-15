import { useEffect, useState } from 'react'
import { highlights, motions } from '../../server/caption-design.mjs'
import type { Language } from '../i18n'
import { defaultAppearance } from './model'
import type { Appearance } from './model'

export type CaptionTemplate = { name: string; appearance: Appearance }

const templates: { tr: string; en: string; look: Partial<Appearance> }[] = [
  { tr: 'Podcast · Yayında', en: 'Podcast · On Air', look: { font: 'segoe', style: 'bold', motion: 'pop', highlightMode: 'word', highlightColor: '#9ef278' } },
  { tr: 'Eğitim · Not Defteri', en: 'Education · Notebook', look: { font: 'verdana', motion: 'fade', highlightMode: 'keywords', highlightColor: '#ffdc87', size: 48 } },
  { tr: 'Teknoloji · Sinyal', en: 'Tech · Signal', look: { font: 'segoe', style: 'bold', motion: 'drop', highlightMode: 'speech', highlightColor: '#76f8eb', secondaryColor: '#b8beff' } },
  { tr: 'Oyun · Arcade', en: 'Gaming · Arcade', look: { font: 'verdana', style: 'bold', motion: 'bounce', highlightMode: 'word', textColor: '#fdf2ff', highlightColor: '#ff8ee5', y: 70 } },
  { tr: 'Motivasyon · İvme', en: 'Motivation · Momentum', look: { style: 'bold', motion: 'pop', highlightMode: 'karaoke', highlightColor: '#ffd55c', size: 60 } },
  { tr: 'Vlog · Gün Işığı', en: 'Vlog · Daylight', look: { font: 'segoe', motion: 'bounce', highlightMode: 'word', highlightColor: '#ffb48c', y: 74 } },
  { tr: 'Haber · Son Dakika', en: 'News · Bulletin', look: { style: 'box', motion: 'drop', highlightMode: 'keywords', backgroundColor: '#25284f', highlightColor: '#ffe0a3', y: 76 } },
  { tr: 'Hikâye · Anlatıcı', en: 'Story · Narrator', look: { font: 'verdana', motion: 'fade', highlightMode: 'karaoke', textColor: '#fff2d6', highlightColor: '#ffad96', size: 46 } },
  { tr: 'Minimal · Sade', en: 'Minimal · Plain', look: { font: 'segoe', motion: 'fade', highlight: false, size: 44, outline: 2, shadow: 0 } },
  { tr: 'Profesyonel · Stüdyo', en: 'Professional · Studio', look: { font: 'segoe', style: 'bold', motion: 'fade', highlightMode: 'keywords', highlightColor: '#a8c9ff', size: 48, y: 72 } },
]

type Props = { language: Language; appearance: Appearance; apply: (value: Appearance) => void; disabled?: boolean }

export function CaptionStudio({ language, appearance, apply, disabled }: Props) {
  const tr = language === 'tr'
  const bridge = window.viralCutDesktop?.studio
  const [custom, setCustom] = useState<CaptionTemplate[]>([])
  const [name, setName] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [selection, setSelection] = useState('')
  const set = (difference: Partial<Appearance>) => apply({ ...appearance, ...difference })
  useEffect(() => {
    if (!bridge) return
    let mounted = true
    void bridge.templates().then(result => { if (mounted && result.templates) setCustom(result.templates) }).catch(() => {})
    return () => { mounted = false }
  }, [bridge])
  async function saveTemplate() {
    if (!bridge || !name.trim() || saving) return
    setSaving(true); setStatus('')
    try {
      const result = await bridge.saveTemplate({ name: name.trim(), appearance })
      if (!result.templates) throw new Error()
      setCustom(result.templates); setName('')
      setStatus(tr ? 'Şablon kaydedildi.' : 'Template saved.')
    } catch { setStatus(tr ? 'Şablon kaydedilemedi.' : 'Could not save the template.') }
    finally { setSaving(false) }
  }
  const animationNames = tr ? ['Kapalı', 'Yavaşça görün / kaybol', 'Pop-up', 'Yukarıdan giriş', 'Sıçrama'] : ['Off', 'Fade in / out', 'Pop-up', 'Drop in', 'Bounce']
  const highlightNames = tr ? ['Kelime vurgusu', 'Karaoke', 'Dönüşümlü konuşma rengi', 'Belirgin kelimeler'] : ['Word highlight', 'Karaoke', 'Alternating speech colors', 'Key terms']
  return <details className="caption-studio"><summary>{tr ? 'Şablonlar ve animasyonlar' : 'Templates and animations'}</summary>
    <fieldset disabled={disabled || saving} className="studio-design-controls">
      <label>{tr ? 'Video şablonu' : 'Video template'}<select value={selection} onChange={event => {
        const value = event.target.value
        setSelection(value)
        if (value.startsWith('custom:')) {
          const item = custom[Number(value.slice(7))]
          if (item) apply(item.appearance)
        } else if (value !== '') {
          const item = templates[Number(value)]
          if (item) apply({ ...defaultAppearance, safe: true, ...item.look })
        }
      }}><option value="">{tr ? 'Şablon seç' : 'Choose a template'}</option>
        {templates.map((item, index) => <option value={index} key={item.en}>{item[language]}</option>)}
        {custom.map((item, index) => <option value={`custom:${index}`} key={item.name}>{item.name}</option>)}
      </select></label>
      <label>{tr ? 'Animasyon' : 'Animation'}<select value={appearance.motion ?? 'none'} onChange={event => set({ motion: event.target.value as Appearance['motion'], safe: true })}>
        {motions.map((motion, index) => <option key={motion} value={motion}>{animationNames[index]}</option>)}
      </select></label>
      <label>{tr ? 'Zamanlı renk' : 'Timed color'}<select value={appearance.highlight ? appearance.highlightMode ?? 'word' : 'off'} onChange={event =>
        set({ highlight: event.target.value !== 'off', highlightMode: event.target.value === 'off' ? undefined : event.target.value as Appearance['highlightMode'], safe: true })}>
        <option value="off">{tr ? 'Kapalı' : 'Off'}</option>{highlights.map((mode, index) => <option key={mode} value={mode}>{highlightNames[index]}</option>)}
      </select></label>
      <label>{tr ? 'Animasyon hızı' : 'Animation speed'} <output>{appearance.speed ?? 1}×</output><input type="range" min=".5" max="2" step=".1" value={appearance.speed ?? 1} onChange={e => set({ speed: e.target.valueAsNumber })} /></label>
      <label>{tr ? 'Kenar kalınlığı' : 'Outline width'}<input type="range" min="0" max="10" value={appearance.outline ?? 3} onChange={e => set({ outline: e.target.valueAsNumber, motion: appearance.motion ?? 'none' })} /></label>
      <label>{tr ? 'Gölge uzaklığı' : 'Shadow distance'}<input type="range" min="0" max="8" value={appearance.shadow ?? 1} onChange={e => set({ shadow: e.target.valueAsNumber, motion: appearance.motion ?? 'none' })} /></label>
      <label>{tr ? 'Kenar rengi' : 'Outline color'}<input type="color" value={appearance.outlineColor ?? appearance.backgroundColor} onChange={e => set({ outlineColor: e.target.value, motion: appearance.motion ?? 'none' })} /></label>
      <label>{tr ? 'İkinci konuşma rengi' : 'Second speech color'}<input type="color" value={appearance.secondaryColor ?? appearance.highlightColor} onChange={e => set({ secondaryColor: e.target.value })} /></label>
      <label>{tr ? 'Yazı tipi' : 'Typeface'}<select value={appearance.font} onChange={e => set({ font: e.target.value as Appearance['font'] })}><option value="arial">Arial</option><option value="segoe">Segoe UI</option><option value="verdana">Verdana</option></select></label>
      <label>{tr ? 'Yazı boyutu' : 'Text size'}<input type="range" min="22" max="100" value={appearance.size} onChange={e => set({ size: e.target.valueAsNumber })} /></label>
      <label>{tr ? 'Yazı rengi' : 'Text color'}<input type="color" value={appearance.textColor} onChange={e => set({ textColor: e.target.value })} /></label>
      <label>{tr ? 'Vurgu rengi' : 'Accent color'}<input type="color" value={appearance.highlightColor} onChange={e => set({ highlightColor: e.target.value })} /></label>
      <label>{tr ? 'Arka plan / gölge' : 'Background / shadow'}<input type="color" value={appearance.backgroundColor} onChange={e => set({ backgroundColor: e.target.value })} /></label>
      <label>{tr ? 'Dikey konum' : 'Vertical position'}<input type="range" min="12" max="83" value={appearance.y ?? ({ top: 17, middle: 50, bottom: 77 })[appearance.position]} onChange={e => set({ y: e.target.valueAsNumber, safe: true })} /></label>
      <button type="button" className="export-cancel" onClick={() => apply({ ...defaultAppearance })}>{tr ? 'Altyazı ayarlarını sıfırla' : 'Reset caption settings'}</button>
      {bridge && <><label>{tr ? 'Özel şablon adı' : 'Custom template name'}<input maxLength={48} value={name} onChange={e => setName(e.target.value)} /></label>
        <button type="button" className="export-cancel" disabled={!name.trim()} onClick={() => void saveTemplate()}>{tr ? 'Şablonu kaydet' : 'Save template'}</button></>}
    </fieldset>
    {status && <p role="status">{status}</p>}
    <p>{tr ? 'Kelime zamanları eksik veya tutarsızsa altyazı cümle düzeyinde yumuşakça görünür.' : 'Missing or inconsistent word timing uses a sentence-level fade.'}</p>
  </details>
}
