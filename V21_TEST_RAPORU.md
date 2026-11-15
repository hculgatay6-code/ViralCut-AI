# ViralCut AI v21.0.0 test raporu

## Başlangıç

[v20 PR #3](https://github.com/hculgatay6-code/ViralCut-AI/pull/3) açık ve birleştirilmemişti. v21 dalı doğrulanmış `bd1791fd3d63c9fcc3360a47764b9743f3a7c8cf` commit’inden açıldı. [v20 raporu](V20_TEST_RAPORU.md), mevcut FFmpeg çizimi, Bézier hesapları, önizleme sınırı, proje güvenliği ve lisans kayıtları incelendi.

## Kullanılabilen özellikler

- Gerçek FFmpeg filtrelerine bağlı **28 video efekti**. Görsel, hareket ve stil kategorileri. Sıralanabilir, kopyalanabilir, geçici olarak kapatılabilir, sıfırlanabilir sekiz adımlı zincir.
- Efekt aralığı klibe göre kareyle belirlenir. Ayrıntı sabit filtre ayarıdır. Yoğunluk, işlenmiş kare ile kaynak kare arasındaki oranı animasyonla değiştirir. Doğrusal, Hold, Ease In/Out/In-Out ve Cubic Bézier eğrileri mevcut.
- Dokuz giriş geçişi. Çapraz çözünme, alt katmandan solma, siyaha/beyaza geçme, silme, kaydırma, itme, piksel ve flaş. Aynı izde bitişik klipler gerekir. Başlangıç şeridi taşınabilir. Süre iki kare ile dört saniye arasında, klip sınırlarıyla kısıtlıdır. Yön seçenekleri silme, kaydırma ve itmede kullanılır.
- Geçiş, önceki klibin son karesini giriş sırasında tutar. Bu çözüm kaynakta kesim sonrasına erişim gerektirmez. Bağımsız ses yolu ve toplam proje süresi aynı kalır. Siyah, beyaz ve flaş bileşik görüntüye uygulanır. Geçiş sırasında iki kaynak için dekoder gerekir.
- **35 hazır paket**. Arama, kategori, favoriler, kayıtlı özel paket ve JSON içe/dışa aktarma. Özel kütüphane Electron profilinde sınırlı ve doğrulanmış verilerle saklanır.
- Copilot’un sinematik, Gaming RGB, eski film ve çapraz çözünme komutları seçili katman klibini düzenler. Hareket isteği kayıtlı Fast Action paketini önerir. Eski Director ve Creator giriş noktaları kullanılabilir.
- v1/v2/v3 okunur. Efekt zinciri veya geçiş içeren düzen v4 olarak yazılır. Efekt ve keyframe verisi klip kırpma/bölmede yeniden hizalanır. Geçişin gerekli komşuluğu kaybolursa geçiş kaldırılır. Undo önceki durumu saklar.

## Test sonuçları

Ortam Windows 11 Home Insider Preview, yapı 26340, Ryzen 5 5600, 16 GB RAM ve RTX 4060. FFmpeg/FFprobe 9.0.2 Essentials, Electron 45.3.2, Node.js 24.21.0.

| Kontrol | Sonuç |
| --- | --- |
| v20 başlangıç regresyonu | **94/94**. Whisper ve yerel semantik testleri açık. |
| v21 son regresyonu | **99/99**, 0 başarısız, 0 atlanan. TypeScript, Vite üretim derlemesi ve lint geçti. |
| 28 efekt | Kontrollü FFmpeg deseninde her efektin kare piksellerini değiştirdiği doğrulandı. |
| Beş efekt ve yoğunluk keyframe’i | FFmpeg 1080p çıktı verdi. Zincir sırası ve yoğunluk eğrisi pikselleri değiştirdi. Eşdeğer önizleme karesinin RGB farkı **0,763/255**. |
| Dokuz geçiş ve katman | Gerçek kareler geçişin başında, ortasında ve sonrasında farklı. Çapraz çözünme için alt katman kenarı, A/V süresi ve kısmi önizleme doğrulandı. RGB farkı **yaklaşık 0,117/255**. Taşınmış geçiş için başlangıç öncesi kare ayrı test edildi. |
| Preset, Copilot ve proje | 35 reçete doğrulandı. Geçersiz kimlik ve JSON reddi, yeniden sıralama, v3 → v4, kurtarma ve geçmiş çalıştı. Seçili katman klibine Copilot uygulaması Windows arayüzünde de çalıştı. |
| Windows masaüstü | Efekt düzenleme, zincir kopyalama/yapıştırma, geçiş şeridini sürükleme, preset kaydı, proje yeniden açma ve İngilizce arayüz kontrolü. Arayüzden **8,000 sn, 1280×720, 240 kare, H.264/AAC** çıktı. |

İlk regresyonda Node test import uzantısı eksikti ve bir altyazı indirme testi zaman aşımına uğradı. Import düzeltildi. Altyazı indirme, ayrı çalıştırıldığında ve takip eden tam koşuda geçti. Bir sonraki koşuda Whisper iptalinden sonra geçici dizin kontrolü aralıklı başarısız oldu. Windows’un geçici dosya kilitleri için sınırlı silme denemesi eklendi ve tam paket tekrar çalıştırıldı.

## Performans

### Zaman çizelgesi ve önizleme

- 20 katman ve 500 efektli klipte paketli Windows uygulaması projeyi **73 ms** içinde gösterdi. 45 yatay kaydırma örneği **12,1 ms** medyan ve **13,5 ms** en uzun süre verdi.
- Ölçüm anında renderer çalışma kümesi **140 MiB**. Electron süreçleri **0,24 CPU-sn / 0,57 sn** duvar süresi kullandı. Bu değer FFmpeg alt sürecini içermez.
- Yaklaşık dört saniyelik çok parçalı Windows önizlemesi, diğer testlerle aynı makinede çalışırken paketli örnekte **10,0 sn** sürdü. Daha kısa, beş efektli kontrollü önizleme **1,57 sn** sürdü. Önceden render edilmiş bir aralığa konumlanırken v20 önizleme önbelleği yeniden kullanılır.
- v20 raporundaki 500 klip örneği de **12,1 ms** medyan verdi. Proje içerikleri farklı olduğu için açılış hızındaki farktan genel hız artışı çıkarılmadı.

### NVENC ile dışa aktarma

| Girdi ve koşu | İşlem süresi | GPU tepe | VRAM tepe |
| --- | ---: | ---: | ---: |
| v20, 45 sn ve iki sabit katman, 720p | 16,05 sn | %36 | 1790 MiB |
| v21, aynı kaynaklar ve 720p ayarları | 14,75 sn | %17 | 1795 MiB |
| v21, 45 sn ve iki katman, beş efekt ve keyframe, 1080p | 59,38 sn | %18 | 1866 MiB |
| v21, 4K kaynakta iki saniye keskinlik, 1080p çıktı | 2,54 sn | %23 | 1687 MiB |

Statik koşuların çıktı dosyası boyutu ve 15. saniyedeki çözülmüş kare özeti eşleşti. Bu tablo tek koşu ve ortak cihaz telemetrisi kullanır. Efekte ve çözünürlüğe göre değişen satırlardan sürüm hızlanması çıkarılmaz. Çıktı doğrulaması beklenen kare sayısını ve AAC ses akışını kontrol etti. Tam zamanlı FFmpeg CPU kullanımı ayrıca örneklenmedi.

## Bilinen sınırlar ve dağıtım

- Efekt stüdyosu video kliplerine bağlı. Metin ve görsel hazırlama için önceki animasyon akışları kullanılabilir. Doğrudan metin/bağımsız görsel efekt hattı, zamansal motion blur ve listedeki ek gelişmiş geçişler bu sürümde eksik.
- Efektli kliplerin tek klip halinde birleştirilmesi henüz uygulanmadı. Başlık, Mastering ve bağımsız ses yolları önceki davranış ve düzenleme noktalarını korur.
- Birleşik önizleme sekiz saniyeyle sınırlı render kullanır. Gerçek zamanlı GPU kompozisyonu ve yeni proxy motoru eksik. NVENC kodlama ve mevcut CPU alternatif yolu korunur.
- Windows x64 Setup ve Portable yerelde üretildi. Portable temiz test profiliyle açıldı, paket içi FFmpeg ile önizleme tamamladı ve kapandığında yerel servisi durdurdu.
- Windows 10 / 8 GB, uzun 4K çıktı, sürücü arızasıyla zorlanan NVENC geçişi ve Setup kurulum/kaldırma doğrulanmadı. 4K denemesi kaynak çözme ve 1080p çıktı içindir.
- Yeni npm bağımlılığı eklenmedi. Electron izolasyonu, sandbox, IPC doğrulaması ve kayıtlı medya erişimi kullanılır. FFmpeg’in statik GPL derlemesinde eşleşen kaynak ve derleme malzemeleri incelemesi açık. Windows paketleri yerel adaydır. [Üçüncü taraf bildirimleri](THIRD_PARTY_NOTICES.md) · [FFmpeg lisans bilgileri](https://ffmpeg.org/legal.html)

## Tekrarlama

- FFmpeg ve FFprobe PATH üzerindeyken `npm run lint`, `npm test -- --test-concurrency=2`.
- Yalnız efekt testleri için `node --test tests/effects-studio.test.mjs`.
- Windows masaüstü akışı için `npm run build` ve `node scripts/verify-v21-effects.mjs`. İsteğe bağlı son argüman paketlenmiş EXE yoludur. Testte kontrollü sentetik medya ve ayrı profil kullanılır.
