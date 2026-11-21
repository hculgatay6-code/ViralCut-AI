# ViralCut AI v24 test raporu

Başlangıç commit’i `f0666d1c242ff37c4bf0f704bd3d4574617400b6`. v23’te 107/107, v24’te 111/111 otomatik test geçti. İki koşuda da başarısız ve atlanan test sayısı 0. TypeScript, Vite üretim derlemesi ve lint geçti. Vite, ana JavaScript paketi için boyut uyarısı verdi.

| Kapsam | Doğrulanan sonuç |
| --- | --- |
| Onaylı profesyonel plan | Kare tabanlı kesim, kaldırılan sessizlikten sonra ses/altyazı zamanının yeniden hesaplanması, mevcut plana ekleme ve tek adımda geri al/yinele |
| Veri ve yol güvenliği | Geçersiz sessizlik aralığı ve kadraj değerleri reddedildi. Gerçek MP4 oluşturulduktan sonra kaynak dosya baytları aynıydı |
| Gerçek katmanlı MP4 | 720×1280, 75 H.264 karesi, AAC, hareketli kadraj ve Türkçe altyazı. Altyazı aralığında piksel farkı gözlendi, bölüm öncesi fark sınır içinde kaldı |
| Toplu dışa aktarma | Geçersiz ilk öğe hata verdi. Sonraki iki öğe 720×720 ve 1280×720 H.264/AAC MP4 olarak doğrulandı |
| Mevcut işlevler | NVENC, CPU ve zorlanmış CPU geri dönüşü, Türkçe/İngilizce Whisper, altyazı yakma, sessiz kaynak, efekt/geçiş, proxy özgün kaynak ayrımı ve eski proje kurtarması |

Uygulama, ilk plana geri alma yapıldığında yeniden uygulama düğmesini gösterir. Yalnızca katmanlı klip içeren projelerde zaman çizelgesi tam çalışma alanını kullanır. Yeniden analiz iptal edilirse önceki öneriler ekranda kalır.

Windows 11’de kurulum EXE’siyle kullanıcı başına kurulum yapıldı. Beş dakikalık gerçek arşiv konuşma videosu üzerinde analiz iptal edilip yeniden başlatıldı. 23 saniyelik hedefle öneri seçildi ve onaylanan plan ayrı video, ses ve altyazı katmanlarına dönüştü. Geri alma, yineleme, kaydetme ve uygulamayı kapatıp projeyi yeniden açma doğrulandı. Dikey MP4 1080×1920, 28,7 saniye, 861 H.264 karesi ve AAC akışı içerdi. FFprobe akış süreleri arasındaki ölçülen fark 0 ms idi. Hedef süre adayın konuşma sınırlarına göre esnedi. Fiziksel Windows 10 test edilmedi.

Setup arşivi 7-Zip bütünlük kontrolünden geçti. Kurulum masaüstü kısayolu oluşturdu. 8 GiB işlem ağacı bellek sınırındaki test ilk denemede süre sınırına ulaştı, ölçümlü tekrarda geçti. v22 proxy ve v23 çalışma alanı Electron regresyonları da geçti.

Son Portable EXE, Node.js içermeyen PATH ile açıldı ve paket içindeki FFmpeg’le işlenen MP4 önizlemesi oynadı. Kapatıldıktan sonra yerel servis yanıt vermedi. Setup ve Portable SHA-256 değerleri yerel paketlerin yanındaki `SHA256SUMS.txt` dosyasındadır. Yerel paketler imzasızdır.

Yeni model indirilmedi. Mevcut yerel Whisper.cpp, multilingual-e5-small, SSD MobileNet V1 INT8 ve Ultra-Light Slim altyapısı kullanıldı. Algoritmik harekete dayalı sıralama ile model tabanlı tespit arayüzde ayrı belirtilir. Model lisansları ve paket bileşenleri [üçüncü taraf bildirimlerinde](THIRD_PARTY_NOTICES.md) yer alır.

Electron’da bağlam yalıtımı ve sandbox etkin, Node erişimi kapalı. Yeni kadraj ve ses değerleri FFmpeg’e ulaşmadan önce doğrulanır. Son kurgu, özgün medya yollarını mevcut dosya kayıt sistemi üzerinden çözer. FFmpeg ve FFprobe yerel test paketinde GPLv3 statik derleme olarak kalır. Bu derlemenin bağlı bileşenleri, yamaları ve derleme betiklerini kapsayan tam Corresponding Source doğrulanamadı. Windows paketleri yerel test içindir. [FFmpeg lisans bilgisi](https://ffmpeg.org/legal.html) · [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html)

Profesyonel zaman çizelgesine taşınan altyazıların kelime animasyonu, tam kaynak boyunca otomatik kurgu, tüm oranlarda nesne takibi, kullanıcı tanımlı dosya adı şablonu ve Copilot için yeni komut ayrıştırma kapsamı bu sürümde tamamlanmadı. Kurgu önerileri, uygulandıktan sonra düzenlenebilir proje klipleri olarak saklanır. Onaylanmamış analiz sonuçları proje dosyasına kaydedilmez.

## v25 öncelikleri

- Tam kaynak kurgusu için kaydedilebilir plan belgesi, kesim başına açıklama ve cümle/kelime zamanlarının katmanlar boyunca korunması.
- Kadraj ve ses karşılaştırmasını aynı aralığın render çıktısında doğrulama. Kuyruğa özel dosya adı şablonu ve kullanıcı onaylı Copilot bağlantısı.
- Fiziksel Windows 10 / 8 GB uçtan uca testleri ve farklı codec kaynaklarında çok tekrarlı performans ölçümü.
- Yeniden dağıtılacak FFmpeg derlemesi için eksiksiz kaynak ve derleme materyali, ardından Windows imzalama süreci.
