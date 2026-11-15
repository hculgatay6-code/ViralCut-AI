import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCopilot } from '../src/editor/copilotPlan.ts'
test('out-of-corpus paraphrases report misses and make no changes on clarification', t => {
const cases=[
 ['Başından çeyrek dakika at','trim',15],['Sesi bir tık aç','audio'],['Lütfen ilk beş saniyeyi çıkar','trim',5],
 ['Klip ikiyi seç','select',1],['Dördüncü klibin sonundan 2 saniye kes','length',2],['Kesip biç ve güzel yap','clarify'],
 ['Bütün videolara aynı altyazı stilini uygula','captionStyle','current'],
 ["Don't export the video",'unsupported'],['Make the text lime green','clarify'],['Take me to 01:20','seek',80],
 ['Get rid of the first five seconds','trim',5],['Reduce the effects a bit','effects'],
 ['Turn it into a portrait video','frame','vertical'],['Set green subtitles, then export as 720p MP4','captions','green'],
 ['Dosyaları sil','unsafe'],['Bunu buluta yükle','unsafe'],['Kesmeni istemiyorum','unsupported'],['Beş tane kısa video hazırla','shorts',5],
 ['Make the captions crimson','clarify'],['Remove clip 2 from the timeline','remove',1],
 ['Shorten the video to half a minute','clarify'],['20 ve 25 saniye arasını çıkar','cutRange',20],
 ['Save the project, then export as 1080p MP4','save'],['En komik sahneyi bul','unsupported'],
]
let correct=0,tools=0
const misses=[]
for(const [command,wanted,arg] of cases){
 const p=parseCopilot(command)
 const step=p.steps?.[0]
 const actual=step?.tool??p.error
 const parameter=step?.seconds??step?.start??step?.index??step?.color??step?.style??step?.mode??step?.count
 if(actual===wanted)tools++
 if(actual===wanted&&(arg===undefined||parameter===arg))correct++
 else misses.push({command,wanted,arg,actual,parameter})
}
t.diagnostic(JSON.stringify({total:cases.length,correct,tools,misses})); assert.ok(correct >= 17); assert.ok(misses.every(item => item.actual === 'clarify'))
})
