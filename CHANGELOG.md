# Değişiklik günlüğü

## v19.0.0

- Kare tabanlı video, ses, altyazı ve metin yolları. Klip taşıma, kenardan kırpma, bölme, birleştirme, snap, ripple, boşluk düzenleme, kopyalama ve ortak geri alma/yineleme.
- Gerçek FFmpeg katman kompozisyonu, Picture-in-Picture, opaklık ve bağımsız ses karışımı. Kısa kompozisyon önizlemesi ile MP4 dışa aktarma aynı filtreleri kullanır.
- v2 proje kaydı, v1 açma ve eski düzeni koruma. Atomik otomatik kayıt, geri yükleme ve medya yeniden bağlama.
- Görünür aralıkla sınırlı çizim, küçük resim önbelleği ve isteğe bağlı ses dalga formu. Sürüm ayrı Windows uygulama kimliğiyle paketlenebilir.
- Testler ve dağıtım durumu için [v19 raporu](V19_TEST_RAPORU.md).

## v18.1-beta

- Otomatik kayıt 5, 15, 30 veya 60 saniyeye ayarlanabiliyor ve kapatılabiliyor.
- İki atomik proje kontrol noktası, v18 kaydından okunabilir geri dönüş ve eksik medya uyarısı eklendi.
- Beklenmedik kapanma işareti ve ayıklanmış yerel JSON tanılama raporu eklendi.
- Ayarlar ve Hakkında bölümü, isteğe bağlı GitHub sürüm kontrolü ve depo, sürümler, Issues kısayolları eklendi.
- Altyazı önizlemesi zaman dizini kullanıyor. Değişmeyen altyazılar oynatma sırasında tekrar dışa aktarma verisine dönüştürülmüyor.
- Açılış kontrolleri paralel çalışıyor. Efekt önizlemesi kısa süreli yerel iş çakışmalarında sınırlı yeniden deneme yapıyor. MP4 iptali temizleme sırasında durum gösteriyor.
- Windows x64 Setup, Portable, SHA-256 dosyası ve elle başlatılan GitHub Actions paketleme adımı hazırlandı.

## v18.0.0

- Yerel YouTube Shorts, TikTok ve Instagram Reels video paketleri, kapak düzenleme, başlık ve içerik taslakları.
- Yerel yayın takvimi ve koşullu YouTube OAuth/yükleme akışı.
