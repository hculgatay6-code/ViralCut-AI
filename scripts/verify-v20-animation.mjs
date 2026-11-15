import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron } from 'playwright'
import { createProjectStore } from '../desktop/projects.mjs'
import { emptyTrack, mediaClip } from '../src/project/layer-model.ts'

const root=resolve(import.meta.dirname,'..')
const directory=await mkdtemp(join(tmpdir(),'viralcut-v20-ui-'))
const ff=(program,...args)=>execFileSync(process.env[program==='ffmpeg'?'VIRALCUT_FFMPEG':'VIRALCUT_FFPROBE']??program,args,
  { windowsHide:true,maxBuffer:4e6,timeout:45000 })
const store=createProjectStore(join(directory,'seed-recovery.viralcut'))
async function source(color) {
  const file=join(directory,color+'.mp4')
  ff('ffmpeg','-v','error','-f','lavfi','-i','color=c='+color+':s=480x270:r=30','-f','lavfi','-i','sine=frequency=440',
    '-t','4','-c:v','libx264','-threads','2','-c:a','aac',file)
  return store.register(file)
}
const blue=await source('blue'), red=await source('red')
const first=mediaClip(blue.id,'video',0,0,120)
const top={...mediaClip(red.id,'video',0,0,120),scale:.35,y:.15}
const timeline={fps:30,tracks:[
  {...emptyTrack('video','V1'),clips:[first]},
  {...emptyTrack('video','V2'),clips:[top]},
  {...emptyTrack('audio','A1'),clips:[mediaClip(blue.id,'audio',0,0,120)]},
]}
const settings={version:2,timeline,media:[blue,red],clips:[],burn:true,encoder:'auto',profile:{resolution:720,fps:30,quality:'balanced',bitrate:0},
  appearance:{style:'classic',font:'arial',position:'bottom',size:52,textColor:'#ffffff',highlightColor:'#b7fa70',backgroundColor:'#151515',highlight:false}}
const seed=join(directory,'seed.viralcut'), saved=join(directory,'animation.viralcut'), output=join(directory,'animation.mp4')
await store.save(seed,settings)
const executable=process.argv[2]
const config={
  executablePath:executable || join(root,'node_modules','electron','dist','electron.exe'),
  args:[...(executable?[]:[root]),'--user-data-dir='+join(directory,'profile')],
  timeout:45000,
}
let app, page, errors
async function launch() {
  app=await _electron.launch(config)
  page=await app.firstWindow()
  await page.setViewportSize({width:1440,height:900})
  errors=[]
  page.on('pageerror',error=>errors.push(error.message))
}
const buttons=(name, scope=page)=>scope.getByRole('button',{name,exact:true})
const field=async (name,value,scope=page)=>{
  const input=scope.getByRole('spinbutton',{name,exact:true})
  await input.fill(String(value)); await input.press('Enter')
}
const dialogs=(open,save)=>app.evaluate(({dialog},data)=>{
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[data.open]})
  dialog.showSaveDialog=async()=>({canceled:false,filePath:data.save})
},{open,save})
const clip=name=>page.locator('[data-kind=video]').getByRole('button',{name,exact:true})
const panel=()=>page.getByRole('region',{name:'Animasyon stüdyosu'})
const playhead=value=>field('İmleç karesi',value)
async function close() {
  const closed=app.waitForEvent('close',{timeout:20000})
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close())
  await closed
}
await launch()
try {
  await dialogs(seed,saved)
  await buttons('Proje aç').click()
  await clip('red.mp4').click()
  await buttons('+ Anahtar kare',panel()).click()
  await field('Seçili değer',.1,panel())
  await playhead(42)
  await buttons('+ Anahtar kare',panel()).click()
  await field('Seçili değer',.88,panel())
  await field('Kareye taşı',48,panel())
  await buttons('◆ 0',panel()).click()
  await panel().getByRole('combobox',{name:'Çıkış eğrisi'}).selectOption('bezier')
  const handle=panel().locator('.keyframe-point').first()
  await handle.scrollIntoViewIfNeeded()
  const box=await handle.boundingBox()
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
  await page.mouse.down(); await page.mouse.move(box.x+18,box.y-10,{steps:4}); await page.mouse.up()
  await buttons('Animasyonu kopyala',panel()).click()
  await clip('blue.mp4').click()
  await buttons('Animasyonu yapıştır',panel()).click()
  await buttons('◆ 48',panel()).waitFor()
  await buttons('Geri al',page.locator('.layer-editor')).click()
  assert.equal(await buttons('◆ 48',panel()).count(),0)
  await buttons('Yeniden yap',page.locator('.layer-editor')).click()
  await buttons('◆ 48',panel()).waitFor()
  await clip('red.mp4').click()
  await buttons('◆ 48',panel()).click()
  await buttons('Kareleri sil',panel()).click()
  assert.equal(await buttons('◆ 48',panel()).count(),0)
  await buttons('Geri al',page.locator('.layer-editor')).click()
  await buttons('◆ 48',panel()).waitFor()
  await playhead(0)
  let posts=0
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/export'))posts++})
  const t0=performance.now()
  await buttons('Buradan 8 sn önizle').click()
  const monitor=page.locator('.layer-monitor video')
  await monitor.waitFor({timeout:45000})
  await page.waitForFunction(()=>document.querySelector('.layer-monitor video')?.readyState>=2)
  const previewMs=performance.now()-t0
  await playhead(42)
  const cached=performance.now()
  await buttons('Buradan 8 sn önizle').click()
  await page.waitForFunction(()=>Math.abs((document.querySelector('.layer-monitor video')?.currentTime??0)-1.4)<.05)
  assert.equal(posts,1)
  console.log('Preview',JSON.stringify({renderMs:previewMs,reusedMs:performance.now()-cached,posts}))
  await buttons('Kapat',page.locator('.layer-monitor')).click()
  await buttons('Projeyi kaydet').click()
  await page.getByText('Kaydedildi animation.viralcut',{exact:true}).waitFor()
  const doc=JSON.parse(await readFile(saved,'utf8'))
  assert.equal(doc.version,3)
  const frames=doc.timeline.tracks[1].clips[0].animation.x
  assert.deepEqual(frames.map(frame=>frame.frame),[0,48])
  assert.equal(frames[0].curve,'bezier')
  assert.notDeepEqual(frames[0].bezier,[.42,0,.58,1])
  await dialogs(saved,output)
  await buttons('Katmanları MP4 hazırla').click()
  await buttons('Proje MP4 dosyasını kaydet').click({timeout:45000})
  await page.getByText('Kaydedildi animation.mp4',{exact:true}).waitFor()
  const info=JSON.parse(ff('ffprobe','-v','error','-show_entries','format=duration:stream=codec_name,width,height,nb_frames','-of','json',output))
  assert.deepEqual(info.streams.map(stream=>stream.codec_name),['h264','aac'])
  assert.equal(info.streams[0].nb_frames,'120')
  assert.equal(Number(info.format.duration),4)
  console.log('MP4', JSON.stringify(info))
  await close()
  await launch()
  await dialogs(saved,saved)
  await buttons('Proje aç').click()
  await clip('red.mp4').click()
  await buttons('◆ 48',panel()).waitFor()
  const big=JSON.parse(JSON.stringify(doc))
  const template=big.timeline.tracks[0].clips[0]
  const channel=Array.from({length:6},(_,i)=>({frame:i*8,value:.15+i*.1,curve:'linear'}))
  big.timeline.tracks=Array.from({length:20},(_,index)=>({
    ...big.timeline.tracks[0],id:crypto.randomUUID(),name:'V'+(index+1),
    clips:Array.from({length:25},(_,i)=>({...template,id:crypto.randomUUID(),at:i*2700+index*5,length:60,animation:{x:channel}})),
  }))
  const large=join(directory,'large.viralcut')
  await writeFile(large,JSON.stringify(big))
  await dialogs(large,large)
  const start=performance.now()
  await buttons('Proje aç').click()
  await page.locator('.layer-label').filter({hasText:'V20'}).waitFor()
  const openMs=performance.now()-start
  const metrics=()=>app.evaluate(({app})=>app.getAppMetrics().map(({pid,type,memory,cpu})=>({pid,type,memory,cpu})))
  const before=await metrics(), startScroll=performance.now()
  const result=await page.locator('.layer-scroll').evaluate(async node=>{
    const times=[],shown=[]
    for(let i=1;i<=45;i++){
      const start=performance.now()
      node.scrollLeft=node.scrollWidth*((i*.17)%1)
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
      times.push(performance.now()-start); shown.push(node.querySelectorAll('.layer-clip').length)
    }
    return {times,shown}
  })
  const after=await metrics(), seconds=(performance.now()-startScroll)/1000
  const cpu=after.reduce((sum,current)=>sum+current.cpu.cumulativeCPUUsage-
    (before.find(prior=>prior.pid===current.pid)?.cpu.cumulativeCPUUsage??current.cpu.cumulativeCPUUsage),0)
  console.log('Animated timeline',JSON.stringify({openMs,medianScroll:result.times.sort((a,b)=>a-b)[22],slowestScroll:Math.max(...result.times),
    maxVisible:Math.max(...result.shown),cpu,seconds,memory:after.map(({type,memory})=>[type,memory.workingSetSize])}))
  await buttons('English').click()
  await buttons('Render layers to MP4').waitFor()
  assert.deepEqual(errors,[])
  console.log('Artifacts',directory)
} finally { await close().catch(()=>app.close()) }
