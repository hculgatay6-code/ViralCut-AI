# ViralCut AI v19.0.0 test raporu

## Başlangıç noktası

| Dal | İncelenen commit | İçerik |
| --- | --- | --- |
| `main` | `f902c0c` | Başlangıç README'si |
| `beta/v18.1` | `a82090e` | Beta belgeleri ve kaynak arşivi |
| `audit/v18.1-hardening` | `debcf2e` | Açık kaynak ağacı, v18.1.1 Beta güvenlik düzeltmeleri ve testleri |

Denetim dalı main'in üç commit ilerisinde. Beta dalı ile denetim dalının ayrımında sırasıyla bir ve üç commit bulunuyor. v19, denetim dalından açılan `feature/v19-professional-timeline` dalında geliştirildi. v18.1 Beta paketleri kendi sürümünde kalıyor.

## İşlevler

- Zaman çizelgesi, V1/A1/CC1 yollarıyla başlar. Video, ses, altyazı ve metin yolları eklenebilir. Klipler kareye göre yerleşir. Aynı yoldaki çakışmalar reddedilir. Video yolları üstten alta katman sırasını gösterir.
- Katman adlandırma, kilit, görünürlük, ses kazancı, Solo/Mute, grup taşıma, snap, normal ve Ripple modları, kenardan kırpma, bölme, bitişik kaynak parçalarını birleştirme, boşluk ekleme/kapatma, kopyalama ve geçmiş araçları eklendi. Ripple, seçilen yoldaki silme ve bitiş kırpma sonrası sonraki klipleri kaydırır. Bir katmanı silmek için önce içindeki klipleri kaldır.
- Üst video katmanları ölçek, X/Y konumu ve opaklık ayarlarıyla birleştirilir. Bağımsız WAV/MP3/M4A eklenebilir ve videonun sesi ayrı bir ses klibi olarak kullanılabilir. FFmpeg, ses kazançlarını uygular ve stereo karışımı sınırlar.
- MP4 ve en çok sekiz saniyelik birleşik önizleme aynı FFmpeg bileşim yolunu kullanır. Çıktı süre, kare sayısı, çözünürlük, H.264/AAC ve tam çözme kontrolünden geçer. NVIDIA NVENC ve libx264 kodlama yolları mevcut.
- v1 dosyaları önceki düzenleyicide açılır. v2 belgesine geçildiğinde eski düzen, klip/efekt/geçiş ve kaynak altyazı bilgileriyle birlikte saklanır. Katmanlı kopya kesimleri ve düz altyazı bloklarını başlangıç olarak alır. Eski ve katmanlı kurgu düzenlemeleri bağımsızdır.
- v2 kayıtları atomik otomatik kayda, çökme kurtarmaya ve parmak izi doğrulamalı yeniden bağlamaya dahil. Kaynak yolları renderer'dan alınmaz. Katman şeması, sınırlar, zamansal çakışmalar ve kayıtlı medya kimlikleri doğrulanır.
- Medya küçük resimleri tek bir çözücü üzerinden, en fazla 48 önbellek girdisiyle hazırlanır. Ses dalga formu mevcut yerel sırayı kullanır. Cetvel ve klip görünümü ekran çevresindeki aralıkla sınırlıdır.

## Geçen testler

Ortam Windows 11 Home Insider Preview, yapı **26340**, Ryzen 5 5600, **16 GB RAM** ve RTX 4060. Node.js 24.21.0, Electron 45.3.2, FFmpeg/FFprobe 9.0.2 Essentials.

| Kontrol | Sonuç |
| --- | --- |
| Denetim dalı değişiklik öncesi | **83/83**. Gerçek Türkçe ve İngilizce Whisper, yerel semantik model ve FFmpeg testleri etkin. |
| v19 otomatik paket | **88/88**, 0 başarısız, 0 atlanan. TypeScript, Vite üretim derlemesi ve Oxlint geçti. |
| Kare düzenleme ve kayıt | Snap, grup taşıma, hedef kilidi, split/join, Ripple, boşluk, undo/redo, bozuk katman belgesi, v1 → v2, yeniden açma, otomatik kayıt ve eksik medya yeniden bağlama. |
| FFmpeg görüntü ve ses | Üst ve alt katmanların beklenen konumda örneklenen pikselleri, üç ayrı frekansın gerçek AAC çıkışında ölçülmesi, Solo ve %50 kazanç, Türkçe başlığın kareye işlenmesi, önizleme eşleşmesi. Test MP4'ü 2,0 sn, 1280×720, 30 FPS, H.264/AAC. NVENC ve açık CPU seçimi doğrulandı. |
| A/V senkronu | Başlangıç ofseti 400 ms olan AAC kaynak, katman sınırı sonrasında beklenen sesi bir kare tolerans içinde başlattı. |
| Hata ve iptal | Geçersiz önizleme aralığı reddedildi. İş iptal edilip yeniden başlatıldı ve tekrar başarılı tamamlandı. |
| Windows masaüstü | Yerel dosya seçicisiyle v2 proje açıldı. Paketli uygulamada birleşik önizleme ve Picture-in-Picture gözlemlendi. Otomasyon sürükleme, bölme, geri alma, küçük resim, WAV ve dalga formu, MP4 kaydetme ve uygulamayı kapatıp projeyi yeniden açmayı doğruladı. Üretilen ayrı MP4 6,0 sn, 1920×1080, 30/1 FPS, H.264/AAC. |
| Bağımlılıklar | Yeni npm bağımlılığı yok. Üretim bağımlılıklarında `npm audit --omit=dev` 0 açık bildirdi. Bu tarama Electron ve FFmpeg ikililerini kapsamaz. |

Kombinasyon testlerinde bilinen renkler ve ses frekansları üretildi. Bunlar ölçülebilir fikstürlerdir. Eski Whisper testleri konuşma örnekleriyle çalıştırıldı.

## Büyük proje ölçümü

20 yol ve 500 klipli, yaklaşık 36 dakikaya yayılan sentetik proje kullanıldı. Açma ölçümü, testin **Proje aç** düğmesine basmasından katmanın arayüzde görünmesine kadar sürer. Kaydırma örneği yatay konum değişikliği ile ikinci animasyon karesi arasındaki süredir.

| Ölçüm | Sonuç |
| --- | ---: |
| Proje açılışı | 147 ms |
| 45 kaydırma örneğinin medyanı / en yavaş örnek | 12,1 ms / 213 ms |
| Aynı anda oluşturulan en yüksek klip öğesi sayısı | 20 / 500 |
| Son ölçümde renderer çalışma kümesi | 140 MiB |
| Son ölçümde Electron ana süreç çalışma kümesi | 128 MiB |
| Kaydırma sırasında Electron süreçlerinin toplam CPU zamanı | 1,16 CPU-sn / 0,84 sn duvar saati |

Çalışma kümeleri anlık süreç ölçümleridir. Aynı sayfaların süreçlerce paylaşılması mümkündür. Bu koşulda GPU/VRAM kullanım telemetrisi ve uzun bir dışa aktarmanın kaynak eğrisi ölçülmedi. Karşılaştırılabilir v18.1 katmanlı kurgu testi olmadığı için hız kazancı yüzdesi hesaplanmadı.

## Sınırlar ve dağıtım

- Bir proje 24 yol, 500 klip ve 24 saatle sınırlı. Aynı anda beş video ile sekiz ses kaynağı işlenebilir. Klip kenarlarını sürükleyerek kırpmak için yakınlaştır.
- Birleşik önizleme render alır. Katmanlı gerçek zamanlı GPU kompozisyonu ve yeni proxy motoru bu dalın dışında. Eski kaynak proxy aracı kullanılabilir. Katmanlı önizleme, dışa aktarma bileşiminin kısa bir parçasını gösterir.
- Eski geçişler, akıllı efektler ve AI iş akışları eski düzenleyici/araçlarında çalışır. Katmanlı kopyaya eski geçişler, efekt otomasyonu ve kelime zamanları aktarılmaz. Yeni altyazı/metin klipleri düz metin taşır ve görünüm proje stilinden gelir.
- Setup ve Portable EXE yerelde oluşturuldu. Paketler imzasız. Portable, Node ve FFmpeg PATH'ten çıkarılmış test ortamında açıldı, paket içi FFmpeg ile efekt önizledi, 1920 px yüksekliğinde kapak hazırladı ve kapanınca yerel servisi durdurdu. İş sırası bir çakışmayı yeniden denedi ve önizleme tamamlandı.
- Windows 10 / 8 GB, Setup kurulum/kaldırma, uzun süreli 4K, canlı YouTube hesabı ve zorlanmış yeni NVENC sürücü arızası bu v19 testinde doğrulanmadı.
- FFmpeg/FFprobe 9.0.2 Essentials GPL derlemesinin statik bağımlılıkları için eşleşen kaynak ve derleme malzemesi incelemesi açık. Yeni Windows Release yayımlanmadı. [Üçüncü taraf bildirimleri](THIRD_PARTY_NOTICES.md) · [FFmpeg lisans rehberi](https://ffmpeg.org/legal.html)

## Tekrarlama

- Gereksinimler ve mevcut yerel modeller hazırken `npm run lint` ve `npm test -- --test-concurrency=2`.
- Katman testleri için `node --test tests/layers.test.mjs`.
- Windows masaüstü akışı için FFmpeg ve FFprobe PATH üzerindeyken `npm run build` ve `node scripts/test-v19-desktop.mjs`. Paketli EXE'yi denemek için son argümana EXE yolunu ver. Betik sentetik dosyalar ve ayrı Electron profili oluşturur. Otomasyonun dosya diyaloglarında fixture yolları kullanılır. Elle yapılan kontrol Windows dosya seçicisini kullandı.
