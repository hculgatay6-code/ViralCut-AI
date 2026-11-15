# ViralCut AI v18.1 Beta doğrulama raporu

## Ortam ve kapsam

Windows 11 Home Insider Preview x64 26340, Ryzen 5 5600, yaklaşık 16 GiB sistem belleği ve NVIDIA RTX 4060. Windows 10 ve 8 GB RAM ayrı ortamda doğrulanmadı. v18 Setup ve Portable dosyaları korunuyor. v18 kaynak yedeği `ViralCut_v18_kaynak_yedegi_20261115_040902.zip` içinde 108 giriş barındırıyor.

## Otomatik doğrulamalar

| Koşu | Geçen | Başarısız | Atlanan |
|---|---:|---:|---:|
| v18 başlangıç | 76 | 0 | 0 |
| v18.1 Beta | 82 | 0 | 0 |

TypeScript, Vite üretim derlemesi ve Oxlint çalıştı. Var olan testler gerçek FFmpeg çıktılarını, Edge ve Chrome editör akışlarını, kesme, birleştirme, iptal, sessizlik temizleme, bir saatlik sentetik kaynakta kesim ve görüntü/ses zamanlamasını denetledi. Whisper modeli Türkçe örneği GPU ile, İngilizce örneği CPU ile işledi. E5 analizi gerçek yerel modelle denendi. Altı yeni test kayıt tercihlerini, sürüm sıralamasını, ağ/erişim hata durumlarını, temizlenmiş tanı raporunu, bozuk otomatik kayıttan geri dönüşü ve örtüşen altyazı aralıklarını kapsadı.

## Kurulu uygulama ve gerçek medya

- Kurulu EXE, Türkçe konuşmalı `istanbul.webm` dosyasını içe aktardı ve oynattı. Bir klip bölünüp tekrar birleştirildi. Proje kaydedilip yeniden açıldı.
- Kurulu uygulama 9.955.492 baytlık, sekiz saniyelik 1920 × 1080 ve 30 FPS MP4 üretti. FFprobe H.264 görüntü ile 48 kHz stereo AAC sesi doğruladı. FFmpeg her iki akışı tamamen çözdü. Görüntü 1, 4 ve 7. saniyelerden alınan karelerle incelendi.
- Normal kapanış akışı çalıştırılmadan uygulama kapatıldı. Yeniden açınca beta otomatik kayıt görüldü ve kurtarıldı. Ayarlar korundu. Dışa aktarılan JSON raporunda beklenmedik kapanma kodu vardı. Test videosu adı ve proje adı raporda bulunmadı. Bozuk proje açılmaya çalışılınca Türkçe hata gösterildi ve açık proje korundu.
- Gerçek GitHub genel yayın listesiyle güncelleme ekranı çalıştı. Ağ kesintisi uygulama testinde kontrollü hata ile taklit edildi. GitHub Issues düğmesinin doğru URL’yi açmak istediği görüldü. Tarayıcı açma çağrısı testte yakalandı ve bir Issue gönderilmedi.
- Yayın Stüdyosu aynı gerçek konuşma kaynağından 36,28 saniyelik üç ayrı 1080 × 1920, 30 FPS H.264/AAC MP4 ve JPEG/JSON dosyaları üretti. Düzenlenmiş PNG ve JPG kapak çıktıları açıldı. Üç videonun da ses ve görüntü akışı tam çözüldü. Altyazı bir örnek karede görüldü. Takvim uygulama yeniden açıldığında korundu.
- Portable kısıtlı PATH ile açıldı, video oynattı, paket içi FFmpeg efekt önizlemesini ve 1080 × 1920 kapağı üretti. Bir kısa süreli yerel 409 yanıtından sonra önizleme tamamlandı. Uygulama kapanınca yerel servis durdu.

Masaüstü otomasyonunda dosya seçici sonuçları test dosyalarına yönlendirildi. Gerçek medya işlemleri kurulu EXE içinde yürütüldü. İlk denemede otomasyon yanlış oynatma sürgüsünü aradı. Bir sonraki denemede kapanış kodu açıkça zorla sonlandırılacak şekilde düzeltildi. Son kurulu EXE senaryosu geçti.

## v18 ve beta performansı

İki kurulu uygulamada aynı gerçek WebM kaynağıyla 500 klip ve 10.000 sentetik altyazı içeren aynı proje düzeni açıldı. Her sürüm üç kez yeni profille 10 saniye oynatıldı. Tabloda medyan değerleri kullanıldı.

| Ölçüm | v18 | v18.1 Beta |
|---|---:|---:|
| Pencereye erişim | 888 ms | 1.038 ms |
| Büyük projeyi açma | 641 ms | 535 ms |
| Ana süreç çalışma kümesi | 165 MiB | 130 MiB |
| Arayüz çalışma kümesi | 231 MiB | 213 MiB |
| Ana süreç ve arayüz birlikte çalışma kümesi | 397 MiB | 343 MiB |
| Ana süreç ve arayüz CPU, Electron örneği | %1,70 | %1,83 |
| Tarayıcı kare aralığı p95 | 6,2 ms | 6,2 ms |
| Oynatmada düşen video karesi | 0 | 0 |

Büyük projenin açılması bu örnekte yaklaşık %16,5 hızlandı. İki süreç için çalışma kümeleri toplamı %13,6 düştü. Açılış medyanı 150 ms uzadı ve birleşik CPU örneği hafif arttı. CPU veya açılış hızında genel iyileşme doğrulanmadı. Çalışma kümelerinde paylaşılan sayfalar iki kez sayılabilir. Bu ölçüm kısa oynatma senaryosudur.

Ayrı Node mikro testinde 10.000 altyazı içinde 10.000 zaman sorgusunun medyan süresi eski tam taramada 1.006,56 ms ve beta indeksinde 4,91 ms idi. İndeks oluşturma 4,31 ms sürdü. Bu ölçüm altyazı aramasına aittir. Uygulama geneli için bu oranda hız artışı çıkarılamaz. Dışa aktarma hızı için eşdeğer A/B testi yapılmadı.

## Dağıtım ve GitHub

Kurulum dosyası ve Portable, Windows x64 için oluşturuldu. Paketler imzasızdır. Kurulu FFmpeg, FFprobe, Whisper ve uygulama arşivinin SHA-256 değerleri paket içi dosyalarla eşleşti. Kullanıcı başına kurulum 0 koduyla tamamlandı. Uygulama sürümü `18.1.0-beta`, Windows dosya sürümü `18.1.0.0`.

Kaldırıcı 0 koduyla bitirdi. Beta EXE’sini ve iki kısayolu kaldırdı. Yeniden kurulum 0 koduyla bitirdi ve masaüstü ile Başlat menüsü kısayollarını geri getirdi. Önceki v18 EXE’sinin SHA-256 değeri değişmedi. Kurulu uygulama dış ağ erişimi kapalı proxy ile yönlendirilip yerel adres hariç tutulduğunda açıldı ve işlenmiş önizleme ile kapak üretti. Fiziksel ağ bağlantısı sistem genelinde kesilmedi.

| Dosya | SHA-256 |
|---|---|
| `ViralCut-AI-v18.1-beta-Setup.exe` | `4745df923ca6d559b275e1bbbbbd6dfa96505c576b7fffef16d7d1b28d8e758b` |
| `ViralCut-AI-v18.1-beta-Portable.exe` | `f6c867cc85cf38569c741a4ad525b0d1cc65ddfa87a129f66b81a48679a0d561` |

Çalışma klasöründe Git deposu veya uzak adres bulunamadı. Uzak deponun geçmişi ve görünürlüğü doğrulanmadı. Commit, push, GitHub dalı, etiket ve Release işlemi yapılmadı. `RELEASE-v18.1-beta.md` yerel yayın taslağı, `.github/workflows/windows-beta.yml` ise salt okunur depo izniyle test ve elle paketleme iş akışıdır. İş akışının YAML yapısı ve gereken medya arşivinin SHA-256 ile doğrulanıp boş klasöre çıkarılması yerelde denetlendi. Actions uzak depoda çalıştırılmadı. Özel GitHub sürümleri oturum açık tarayıcıdan incelenebilir. Uygulamadaki anonim sürüm kontrolü GitHub’ın erişime açık sonuçlarını okur. [GitHub Releases API](https://docs.github.com/en/rest/releases/releases)

## Dağıtım öncesi kalanlar

- Özel GitHub depo adresi ve yetkisi doğrulanmalı. Uzak geçmiş üzerinden beta dalı ve `v18.1-beta` ön sürüm taslağı hazırlanmalı.
- Windows 10 / 8 GB gerçek bilgisayarda açılış, uzun oynatma, büyük dışa aktarma ve çökme geri dönüşü ölçülmeli.
- Paketli statik FFmpeg için karşılık gelen kaynak kapsamı doğrulanmalı. Model ve bağımlılık bildirimleri `THIRD_PARTY_NOTICES.md` dosyasında bulunur. [FFmpeg yasal bilgiler](https://ffmpeg.org/legal.html)
- Windows SmartScreen davranışı ve temiz Windows kurulumunda Visual C++ gereksinimi ayrı doğrulanmalı. Canlı sosyal medya yayınları bu beta doğrulamasının dışında kaldı.
