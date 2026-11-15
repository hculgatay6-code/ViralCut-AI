import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron } from 'playwright'
import { createProjectStore } from '../desktop/projects.mjs'
import { emptyTrack, mediaClip } from '../src/project/layer-model.ts'

const root=resolve(import.meta.dirname,'..')
const directory=await mkdtemp(join(tmpdir(),'viralcut-v21-ui-'))
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
const top={...mediaClip(red.id,'video',120,0,120)}
const timeline={fps:30,tracks:[
  {...emptyTrack('video','V1'),clips:[first,top]},
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
const clip=name=>page.locator('[data-kind=video]').getByTitle(name,{exact:true})
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
  let fx=page.getByRole('region',{name:'Efekt stüdyosu'})
  await fx.waitFor()
  await page.locator('.studio-tools').getByRole('button',{name:'Efektler',exact:true}).click()
  const library=page.locator('.effect-library-host')
  await library.getByRole('textbox',{name:'Efekt ara'}).fill('Gauss')
  await buttons('+ Gauss bulanıklığı',library).click()
  await library.getByRole('textbox',{name:'Efekt ara'}).fill('Işıma')
  await buttons('+ Işıma',library).click()
  await buttons('Yukarı',fx).click()
  assert.equal(await fx.locator('.effect-row').first().locator('button').textContent(),'Işıma')
  await fx.locator('.effect-row').first().getByRole('checkbox').uncheck()
  await fx.locator('.effect-row').first().getByRole('checkbox').check()
  await playhead(120)
  await buttons('+ Yoğunluk karesi (0)',fx).click()
  await field('Kare yoğunluğu %',15,fx)
  await playhead(132)
  await buttons('+ Yoğunluk karesi (12)',fx).click()
  await field('Kare yoğunluğu %',85,fx)
  await fx.getByRole('combobox',{name:'Geçiş türü'}).selectOption('dissolve')
  const stripe=clip('red.mp4').locator('[data-fx-transition]')
  await stripe.hover()
  const box=await stripe.boundingBox()
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
  await page.mouse.down()
  await page.mouse.move(box.x+box.width/2+12,box.y+box.height/2,{steps:4})
  await page.mouse.up()
  const moved=Number(await fx.getByRole('spinbutton',{name:'Klipte başlangıç',exact:true}).inputValue())
  assert.ok(moved>0)
  await field('Klipte başlangıç',4,fx)
  await fx.getByText('Özel ön ayar ve JSON',{exact:true}).click()
  await fx.getByRole('textbox',{name:'Ön ayar adı'}).fill('QA özel')
  await buttons('Ön ayarı kaydet',fx).click()
  await library.getByRole('combobox',{name:'Efekt ön ayarı'}).selectOption('custom:QA özel')
  const copy=await page.evaluate(()=>window.viralCutDesktop.effectsLibrary.read())
  assert.ok(copy.names['QA özel'])
  await buttons('Zinciri kopyala',fx).click()
  await clip('blue.mp4').click()
  await fx.getByText('Özel ön ayar ve JSON',{exact:true}).click()
  await buttons('Zinciri yapıştır',fx).click()
  await fx.locator('.effect-row').nth(1).waitFor()
  await buttons('Geri al',page.locator('.layer-editor')).click()
  assert.equal(await fx.locator('.effect-row').count(),0)
  await clip('red.mp4').click()
  await page.locator('.studio-tools').getByRole('button',{name:/copilot/i}).click()
  await page.getByRole('textbox',{name:'Düzenleme komutu'}).fill('Bu videoya sinematik efekt uygula.')
  await buttons('Plan oluştur').click()
  await buttons('Planı uygula').click()
  await fx.locator('.effect-row').nth(3).waitFor()
  await buttons('Geri al',page.locator('.layer-editor')).click()
  assert.equal(await fx.locator('.effect-row').count(),2)
  await playhead(116)
  const start=performance.now()
  await buttons('Buradan 8 sn önizle').click()
  const monitor=page.locator('.layer-monitor video')
  await monitor.waitFor({timeout:45000})
  await page.waitForFunction(()=>document.querySelector('.layer-monitor video')?.readyState>=2)
  console.log('Desktop preview ms',Math.round(performance.now()-start))
  await buttons('Kapat',page.locator('.layer-monitor')).click()
  await buttons('Projeyi kaydet').click()
  await page.getByText('Kaydedildi animation.viralcut',{exact:true}).waitFor()
  const doc=JSON.parse(await readFile(saved,'utf8'))
  assert.equal(doc.version,4)
  const clipData=doc.timeline.tracks[0].clips[1]
  assert.deepEqual(clipData.effects.map(effect=>effect.id),['glow','blur'])
  assert.equal(clipData.incoming.start,4)
  await dialogs(saved,output)
  await buttons('Katmanları MP4 hazırla').click()
  await buttons('Proje MP4 dosyasını kaydet').click({timeout:60000})
  await page.getByText('Kaydedildi animation.mp4',{exact:true}).waitFor()
  const info=JSON.parse(ff('ffprobe','-v','error','-show_entries','format=duration:stream=codec_name,width,height,nb_frames','-of','json',output))
  assert.deepEqual(info.streams.map(stream=>stream.codec_name),['h264','aac'])
  assert.equal(info.streams[0].nb_frames,'240')
  assert.equal(Number(info.format.duration),8)
  console.log('MP4',JSON.stringify(info))
  await close()
  await launch()
  fx=page.getByRole('region',{name:'Efekt stüdyosu'})
  await dialogs(saved,saved)
  await buttons('Proje aç').click()
  await clip('red.mp4').click()
  await fx.getByRole('combobox',{name:'Geçiş türü'}).waitFor()
  assert.equal(await fx.getByRole('combobox',{name:'Geçiş türü'}).inputValue(),'dissolve')
  const reopened=await page.evaluate(()=>window.viralCutDesktop.effectsLibrary.read())
  assert.ok(reopened.names['QA özel'])
  assert.deepEqual(errors,[])
  const long=JSON.parse(JSON.stringify(doc))
  const template=long.timeline.tracks[0].clips[1]
  long.timeline.tracks=Array.from({length:20},(_,i)=>({
    ...long.timeline.tracks[0],id:crypto.randomUUID(),name:'V'+(i+1),
    clips:Array.from({length:25},(_,j)=>({...template,id:crypto.randomUUID(),at:j*2700+i*4,length:120,incoming:undefined})),
  }))

  const large=join(directory,'large.viralcut')
  await writeFile(large,JSON.stringify(long))
  await dialogs(large,large)
  const open=performance.now()
  await buttons('Proje aç').click()
  await page.locator('.layer-label').filter({hasText:'V20'}).waitFor()
  const openMs=performance.now()-open
  const read=()=>app.evaluate(({app})=>app.getAppMetrics())
  const before=await read()
  const beginning=performance.now()
  const times=await page.locator('.layer-scroll').evaluate(async element=>{
    const values=[]
    for(let i=1;i<=45;i++){
      const now=performance.now();element.scrollLeft=element.scrollWidth*((i*.17)%1)
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
      values.push(performance.now()-now)
    }
    return values.sort((a,b)=>a-b)
  })
  const seconds=(performance.now()-beginning)/1000,after=await read()
  const cpu=after.reduce((sum,row)=>sum+row.cpu.cumulativeCPUUsage-(before.find(prior=>prior.pid===row.pid)?.cpu.cumulativeCPUUsage??row.cpu.cumulativeCPUUsage),0)
  console.log('500 clips',JSON.stringify({openMs,median:times[22],max:times.at(-1),cpu,seconds,rendererMiB:(after.find(row=>row.type==='Tab')?.memory.workingSetSize??0)/1024}))
  await buttons('English').click()
  await buttons('Render layers to MP4').waitFor()
  console.log('Artifacts',directory)
} finally { await close().catch(()=>app.close()) }
