# ViralCut AI v20.0.0 test raporu

## Başlangıç ve kapsam

v19'un [PR #2](https://github.com/hculgatay6-code/ViralCut-AI/pull/2) kaydı çalışma başında açık, taslak ve birleştirilmemişti. [v19 test raporu](V19_TEST_RAPORU.md), denetim kayıtları, proje biçimi ve FFmpeg katman motoru incelendi. v20 dalı, doğrulanan `dda35b0504299aed8787d90342872f52046e8f50` commit'inden açıldı. Önceki efekt motoru, altyazı ve AI araçları mevcut düzenleme giriş noktalarından kullanılabilir.

## Animasyon motoru

- Video ve PiP için X/Y, ölçek, dönüş ve opaklık. Metin ve altyazıda aynı kanallara ek olarak Unicode karakter grubu bazında açılma. Bağımsız ses kliplerinde ses kazancı.
- Tam kare cinsinden, klibe göre anahtar kareler. Linear, Hold, Ease In/Out/In-Out ve düzenlenebilir Cubic Bézier. Kareler arasında hesap aynı parametrelerden yapılır.
- Sağ panelde çoklu seçim, sayısal taşıma, silme, animasyon kopyalama ve yapıştırma. Timeline elmasları tıklanabilir ve sürüklenebilir. Grafikte Bézier tutamaçları sürüklenebilir. Düzenlemeler uygulamanın undo/redo geçmişine yazılır.
- Süresi ve şiddeti ayarlanabilen 23 şablon. Uygun konuşma zamanlamasından önerilen zoom, kullanıcı seçince ölçek anahtar karelerine dönüşür.
- Bölme ve kırpma, eğrileri klip sınırlarında örnekler. Aynı animasyon kanallarına sahip, diğer birleştirme kurallarını karşılayan bitişik parçalar yeniden birleştirilebilir.
- v1 ve v2 açılır. İlk animasyon eklendiğinde v3 yazılır. Klip türüne uymayan kanallar, sınır dışı değerler, yinelenen veya sırasız kareler ve büyük belgeler reddedilir. Sınırlar kanal başına 128 ve proje başına 12.000 anahtar karedir. Kayıtlı medya kimliklerine dayanan dosya erişimi ve atomik proje kayıtları kullanılır.
- Önizleme ve dışa aktarma aynı FFmpeg kompozisyonunu kullanır. Hazır en çok sekiz saniyelik aralık açıkken yeniden konumlandırma mevcut videoyu kullanır. İçerik değişirse yeni render gerekir. Uzun opaklık ve metin animasyonlarında ara çalışma belleğini sınırlamak için 30 saniyelik işleme sınırları uygulanır.

## Testler

Ortam Windows 11 Home Insider Preview yapı 26340, Ryzen 5 5600, 16 GB RAM, RTX 4060, FFmpeg/FFprobe 9.0.2 Essentials ve Electron 45.3.2.

| Test | Gerçek sonuç |
| --- | --- |
| Dokunulmamış v19 | **89/89**, 0 başarısız, 0 atlanan. Paket, Windows Electron akışını da içeriyordu. |
| v20 regresyon | **94/94**, 0 başarısız, 0 atlanan. TypeScript, Vite üretim derlemesi ve Oxlint geçti. Türkçe/İngilizce Whisper ve yerel semantik testleri etkin çalıştı. |
| Eğri ve belge | Linear, Hold, Ease ve özel Bézier, kare sınırı ve yinelenen kare reddi, split/join, geri alma, 23 şablonun geçerli ve düzenlenebilir veri oluşturması, v1/v2 açma, v3 kaydetme ve kurtarma. |
| FFmpeg ve FFprobe | Eşzamanlı PiP hareketi, ölçek, dönüş, opaklık, hareketli Türkçe başlık ve metin açılması, ses kazancı. Aynı gerçek 1280×720 MP4 içinde görüntü ve AAC ses doğrulandı. NVENC ve açık CPU seçimi çalıştırıldı. |
| Önizleme eşleşmesi | Üretim ve önizlemedeki aynı aktif animasyon karesi 160×90 RGB'ye örneklendi. Kanal başına ortalama mutlak fark **0,049 / 255**. PiP maskesinde 1.512 ve 1.511 piksel, başlık maskesinde her iki karede 123 piksel. Bunlar kontrollü tek örneğin ölçümleridir. |
| İşleme sınırı | Hareketli başlık 30 saniyelik sınırı geçti. 32 saniyelik çıktı **960 kare** ve FFmpeg tam çözme doğrulamasından geçti. |
| Windows masaüstü | Paketlenmiş Electron'da proje açıldı. Anahtar kare eklendi, taşındı, silindi, Bézier tutamacı sürüklendi. Kopyalama, undo/redo, v3 kaydetme ve yeniden açma geçti. Arayüzden üretilen MP4 **4 sn, 1280×720, 120 kare, H.264/AAC**. İngilizce arayüze geçiş doğrulandı. Otomasyon dosya diyalogları için test yolları sağladı. |

Önizleme karşılaştırması ilk denemede döndürülmüş köşelerde farklı pikseller buldu. Döndürme filtresi için açık şeffaf dolgu ve değişken ölçek için sabit boyutlu şeffaf kompozisyon tamponu uygulandı. Düzeltilen çıktı tekrar ölçüldü. A/V testlerinde kontrollü görüntü ve tonlar, Whisper testlerinde konuşma örnekleri kullanıldı.

## Performans

20 yol ve 500 klip için ardışık 45 yatay kaydırma ölçümü yapıldı. Render sürecinin çalışma kümesi ve işleme süresi ayrı anlam taşır.

| Ölçüm | v19 aynı temel test | v20 aynı temel test | v20 animasyonlu test |
| --- | ---: | ---: | ---: |
| Proje açma | 186 ms | 199 ms | 105 ms |
| Medyan kaydırma | 12,1 ms | 12,1 ms | 12,1 ms |
| Renderer çalışma kümesi | 142 MiB | 144 MiB | 146 MiB |
| Electron CPU zamanı / duvar süresi | 0,90 / 0,60 sn | 0,93 / 0,60 sn | 0,76 / 0,63 sn |
| Görünen en yüksek klip öğesi sayısı | 20 | 20 | 20 |

Animasyonlu proje farklı bir test fikstürüyle 3.000 anahtar kare içeriyordu. Paketli uygulamada dört saniyelik önizleme **2,42 sn**'de hazır oldu. Aynı aralıkta hazır MP4'e konumlanma **55 ms** sürdü ve ikinci render isteği oluşmadı.

Aynı 45 saniyelik sentetik video, aynı 720p30 profil ve NVENC ile işlendi. Statik karşılaştırmada iki sürüm aynı çıktı boyutunu (29.180.394 bayt) ve 15. saniyede aynı çözülmüş kare özetini verdi.

| 45 sn dışa aktarma | Süre | En yüksek GPU | En yüksek VRAM |
| --- | --- | ---: | ---: |
| v19, sabit PiP | 11,19 ve 18,99 sn, medyan 15,09 sn | %50 | 741 MiB |
| v20, sabit PiP | 16,07 ve 16,65 sn, medyan 16,36 sn | %48 | 737 MiB |
| v20, animasyonlu PiP | 14,92 sn, bir koşu | %22 | 737 MiB |

Bu örnekte statik v20 medyanı yaklaşık **%8,4 daha uzun**. İki koşuluk örnek, geniş süre saçılımı ve arka plandaki yük nedeniyle genel performans iddiası için yetersiz. GPU ve VRAM sayıları cihaz genelinde 300 ms arayla örneklendi. Animasyonlu çıktının içeriği farklı olduğu için statik çıktıyla hız kazancı hesaplanmadı.

## Dağıtım ve kalan sınırlar

- Katman kompozisyonu render tabanlıdır. Donanım hızlandırması burada kodlama için kullanıldı. Anlık GPU kompozisyonu ve uzun önizlemeler ayrı çalışma gerektirir.
- Döndürme klibin görüntü kutusuna uygulanır. Köşeler bu kutunun dışında kalabilir. Keyframe kullanılan metin kliplerinde proje yazı stili ve anahtar kare animasyonu uygulanır.
- İmzasız Windows x64 Setup ve Portable oluşturuldu. Portable, Node.js ve FFmpeg PATH'ten çıkarılmışken açıldı, paket içi FFmpeg efekt önizlemesini tamamladı ve kapanınca yerel servisi durdurdu. Mevcut önizleme sırası geçici iş çakışmasını yeniden deneyerek çözdü.
- Windows 10 / 8 GB, Setup kurulum/kaldırma, 4K uzun dışa aktarma, saatler süren bellek testi, zorlanan NVENC sürücü arızası ve canlı yayın hesapları doğrulanmadı.
- Yeni npm bağımlılığı eklenmedi. Paket içi FFmpeg/FFprobe 9.0.2 Essentials GPL derlemesinin statik bağımlılıkları için eşleşen kaynak ve derleme malzemeleri incelemesi açık. v20 paketleri yerel doğrulama adayıdır. [Üçüncü taraf bildirimleri](THIRD_PARTY_NOTICES.md) · [FFmpeg lisans bilgileri](https://ffmpeg.org/legal.html)

## Tekrarlama

- FFmpeg ve FFprobe PATH üzerindeyken `npm run lint`, `npm test -- --test-concurrency=2`.
- Yalnız keyframe testleri için `node --test tests/keyframes.test.mjs`.
- Windows masaüstü akışı için `npm run build` ve `node scripts/verify-v20-animation.mjs`. İsteğe bağlı son argüman paketlenmiş Windows EXE yoludur.
