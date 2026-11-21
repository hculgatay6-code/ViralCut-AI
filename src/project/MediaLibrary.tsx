import { useMemo, useRef, useState } from 'react'
import { Film, Volume2 } from 'lucide-react'
import type { Project, ProjectMedia } from './model'
import { useLayerThumbnails } from './layer-thumbnails'

const rowHeight = 58

export function MediaLibrary({ project, selected, tr, open, remove }: {
  project: Project; selected?: string; tr: boolean; open(media: ProjectMedia): void; remove(id: string): void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [order, setOrder] = useState('added')
  const [scroll, setScroll] = useState(0)
  const [audio, setAudio] = useState<string>()
  const scroller = useRef<HTMLDivElement>(null)
  const thumbnail = useLayerThumbnails(scroller, project.media)
  function resetScroll() { setScroll(0); if (scroller.current) scroller.current.scrollTop = 0 }
  const t = (turkish: string, english: string) => tr ? turkish : english
  const rows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase(tr ? 'tr' : 'en')
    const matches = project.media.filter(item => item.name.toLocaleLowerCase(tr ? 'tr' : 'en').includes(search) &&
      (filter === 'all' || (filter === 'audio' && item.audioOnly) || (filter === 'video' && !item.audioOnly) ||
        (filter === 'captions' && item.cues.length) || (filter === 'missing' && item.missing)))
    if (order === 'name') matches.sort((a, b) => a.name.localeCompare(b.name, tr ? 'tr' : 'en'))
    if (order === 'size') matches.sort((a, b) => b.size - a.size)
    return matches
  }, [project.media, query, filter, order, tr])
  const linked = useMemo(() => new Set([...project.clips.map(clip => clip.mediaId),
    ...(project.timeline?.tracks.flatMap(track => track.clips.map(clip => clip.mediaId)) ?? [])]), [project.clips, project.timeline])
  const start = Math.max(0, Math.min(rows.length - 1, Math.floor(scroll / rowHeight) - 2))
  return <>
    <div className="media-filters">
      <input type="search" aria-label={t('Medya ara', 'Search media')} placeholder={t('Medya ara', 'Search media')}
        value={query} onChange={event => { resetScroll(); setQuery(event.target.value) }} />
      <select aria-label={t('Medya türü', 'Media type')} value={filter} onChange={event => { resetScroll(); setFilter(event.target.value) }}>
        <option value="all">{t('Tümü', 'All')}</option><option value="video">{t('Video', 'Video')}</option>
        <option value="audio">{t('Ses', 'Audio')}</option><option value="captions">{t('Altyazılı kaynaklar', 'Sources with captions')}</option>
        <option value="missing">{t('Eksik', 'Missing')}</option>
      </select>
      <select aria-label={t('Medyayı sırala', 'Sort media')} value={order} onChange={event => { resetScroll(); setOrder(event.target.value) }}>
        <option value="added">{t('Eklenme sırası', 'Added order')}</option><option value="name">{t('Dosya adı', 'Name')}</option>
        <option value="size">{t('Boyut', 'Size')}</option>
      </select>
    </div>
    <div className="media-scroll" ref={scroller} tabIndex={0}
      aria-label={t('Medya listesi', 'Media list')} onScroll={event => setScroll(event.currentTarget.scrollTop)}
      hidden={!rows.length}>
      <div style={{ height: rows.length * rowHeight, position: 'relative' }}>
        {rows.slice(start, start + 10).map((item, index) => <div className="media-row" key={item.id} style={{ top: (start + index) * rowHeight }}>
          <button type="button" title={item.name} aria-current={item.id === selected || item.id === audio} disabled={item.missing}
            draggable={!item.missing && !!project.timeline} onClick={() => {
              setAudio(item.audioOnly ? item.id : undefined)
              if (!item.audioOnly) open(item)
            }} onDragStart={event => {
              event.dataTransfer.setData('application/x-viralcut-media', item.id)
              event.dataTransfer.effectAllowed = 'copy'
            }}>
            {item.audioOnly ? <Volume2 size={15} /> : item.missing ? <Film size={15} />
              : <img className="media-thumb" alt="" ref={thumbnail} data-source={item.id} data-time={0.1} />}
            <span>{item.name}</span>
          </button>
          {!linked.has(item.id) && <button type="button" className="media-remove" aria-label={t('Projeden çıkar', 'Remove from project') + ' ' + item.name}
            onClick={() => remove(item.id)}>×</button>}
          <small>{item.missing ? t('Eksik dosya', 'Missing file') : (item.size / 1048576).toFixed(1) + ' MiB'}{item.cues.length > 0 && ' · ' + item.cues.length + ' CC'}</small>
        </div>)}
      </div>
    </div>
    {!rows.length && <p>{t('Eşleşen medya yok.', 'No matching media.')}</p>}
    {audio && project.media.some(item => item.id === audio && !item.missing) && <audio controls preload="metadata" src={'/project-media/' + audio} />}
  </>
}
