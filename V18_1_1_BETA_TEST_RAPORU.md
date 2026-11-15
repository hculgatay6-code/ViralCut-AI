# ViralCut AI v18.1.1 Beta aday doğrulaması

Windows 11 x64 üzerinde yerel bakım adayı doğrulandı. Windows 10 ve 8 GB RAM koşulları test edilmedi. Bu sürümün EXE dosyaları yerel test içindir. GitHub Release oluşturulmadı.

| Kontrol | Sonuç |
| --- | --- |
| Otomatik testler | 83 geçti, 0 başarısız, 0 atlandı. Gerçek Whisper GPU/CPU, E5 ve FFmpeg testleri etkinleştirildi. |
| TypeScript, Vite ve Oxlint | Geçti. |
| Yerel aday uygulama | Gerçek WebM içe aktarma ve oynatma, proje kaydetme, zorla kapanma sonrası kurtarma, bozuk proje uyarısı ve yerel rapor dışa aktarma geçti. |
| Gerçek proje çıktısı | 8,00 saniye, 1920 × 1080, 30 FPS, H.264, 48 kHz stereo AAC. İki akış FFmpeg ile çözüldü ve örnek görüntü karesi incelendi. |
| Portable EXE | İlk paket açılışta medya aracı doğrulama uyarısı verdi. Açılış süresi sınırı artırıldı. Yeniden oluşturulan EXE kısıtlı PATH ile açıldı, videoyu oynattı, FFmpeg ile efekt önizlemesi ve 1080 × 1920 kapak üretti. İlk yerel önizleme isteğinde kısa bir 409 yanıtı görüldü ve sonraki deneme geçti. |
| Setup EXE | Yeniden oluşturuldu. Kurulum adayının paketlenmiş uygulama içeriği doğrulandı ve SHA-256 kaydedildi. Aday Setup mevcut beta kurulumunun üzerine kurulmadı. |
| Önceki GitHub Release | Dört indirme adresi yanıt verdi. Yerel dosyalarla GitHub özetleri eşleşti. `v18.1-beta` etiketi ve eski paketler korundu. |
| GitHub Actions | Windows test işi salt okunur depo izniyle çalışır. FFmpeg arşivi paket açılmadan önce SHA-256 ile doğrulanır. Yayımlama adımı yoktur. |

## Yerel paket SHA-256

| Dosya | SHA-256 |
| --- | --- |
| `ViralCut-AI-v18.1.1-beta-Setup.exe` | `77035cb19ad9bdefc08e67ae45f759d398054d192b4fcc6d8bd61e1e557afb6e` |
| `ViralCut-AI-v18.1.1-beta-Portable.exe` | `e55639a5642404b70e79ccba94d3a324d2c35926d577d9648cc64c481c1b70c5` |

Paketler imzasızdır. FFmpeg 9.0.2 kaynak arşivi ve bileşen bildirimleri adayda bulunur. Bağlı kütüphaneleri ve derleme girdilerini kapsayan tam kaynak seti henüz doğrulanmadı. Ayrıntılar [üçüncü taraf bildirimlerinde](THIRD_PARTY_NOTICES.md).
