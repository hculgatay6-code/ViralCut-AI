# ViralCut AI v21.0.0 ve v22.0.0 performans ölçümü

## Ortam ve yöntem

Windows 11 Home Insider Preview, yapı 26340, Ryzen 5 5600, 15,93 GiB kullanılabilir sistem RAM’i ve 8 GiB VRAM’li RTX 4060. Node 24.21.0, Electron 45.3.2 ve FFmpeg/FFprobe 9.0.2. v21 başlangıcı, GitHub’da doğrulanan `6f7a839346ead21c88b144611504b49be92a8d34` commit’idir.

İki sürümde aynı yerel MP4 dosyaları, iki video katmanı, bir ses katmanı, üst klipte beş efekt ve 1280×720/30 FPS ayarı kullanıldı. 5 ve 30 dakikalık dosyalar 10 saniyelik kontrollü desen ve ses parçalarının kodlanmadan birleştirilmesiyle hazırlandı. İlk önizleme kaynağın sonlarına yakın sekiz saniyeyi işler. Sonra farklı bir aralık açılır ve ilk aralık yeniden istenir. 30 dakikalık kaynağın ölçümü bu aralıktaki arama ve işleme süresidir. Süreler her sürüm için birer koşudur.

## Aynı kaynakla sonuçlar

| Kaynak ve işlem | v21 | v22 |
| --- | ---: | ---: |
| 1080p / 5 dk, ilk önizleme | 6,506 sn | 5,395 sn |
| 1080p / 5 dk, aynı aralığa dönüş | 6,420 sn | 0,053 sn |
| 1080p / 30 dk, ilk önizleme | 6,486 sn | 5,246 sn |
| 1080p / 30 dk, aynı aralığa dönüş | 6,423 sn | 0,046 sn |
| 4K / 5 dk, ilk önizleme | 8,242 sn | 6,815 sn |
| 4K / 5 dk, aynı aralığa dönüş | 7,020 sn | 0,058 sn |
| 1080p / 5 dk kaynaktan 12 sn NVENC MP4 | 9,429 sn | 7,848 sn |
| 20 katman, 500 klip, açılıp zaman çizelgesinin görülmesi | 205,7 ms | 217,0 ms |
| Aynı projede 45 yatay kaydırma, medyan / en uzun | 12,1 / 13,0 ms | 12,1 / 13,4 ms |
| Aynı projede ölçüm anında arayüz süreci RAM | 143,0 MiB | 137,6 MiB |
| Aynı projede örnek aralıkta Electron CPU süresi | 0,72 CPU-sn | 0,92 CPU-sn |

Üç geri dönüşte de doğrulanmış önizleme dosyasını yeniden kullanmak beklemeyi yaklaşık **%99,2** azalttı. İlk render süreleri sistem yüküne bağlı tek koşulardır. 500 klipli projede kaydırma medyanı aynı kaldı ve yükleme 11,3 ms daha uzun ölçüldü.

### Sistem ve GPU ölçümleri

| Senaryo | v21 sistem CPU / tepe RAM | v22 sistem CPU / tepe RAM | v21 → v22 GPU / VRAM tepe |
| --- | --- | --- | --- |
| 1080p / 5 dk, ilk önizleme | %68 / 11.338 MiB | %50 / 10.916 MiB | %16 / 978 → %33 / 1.037 MiB |
| 1080p / 30 dk, ilk önizleme | %55 / 11.554 MiB | %48 / 11.012 MiB | %15 / 992 → %7 / 991 MiB |
| 4K / 5 dk, ilk önizleme | %43 / 10.468 MiB | %52 / 11.128 MiB | %10 / 1.016 → %7 / 1.027 MiB |
| 1080p / 5 dk kaynaktan NVENC MP4 | %66 / 11.312 MiB | %56 / 10.948 MiB | %37 / 1.212 → %17 / 1.066 MiB |

Bu değerler işletim sistemi ve diğer açık süreçleri de içerir. Kısa önbellek isabetleri 200 ms aralıklı GPU örneklerinden daha kısa sürdü. Önizleme kıyasının Node hizmeti çalışma kümesi v21’de 78–92 MiB, v22’de 78–91 MiB idi. FFmpeg ve Electron ayrı süreçlerdir.

### Proxy, oynatma ve AI

- Aynı 1080p / 5 dk kaynaktan v21’in 24 FPS proxy işlemi 20,229 sn sürdü. v22 CPU yolu 360p, 30 FPS kaynak zamanlamasını koruyan proxy’yi 18,914 sn’de üretti. Çıktı zamanlamaları farklı olduğundan bu satırlardan eşdeğer kalite için hızlanma yüzdesi hesaplanmadı.
- v22’de aynı aralığın ilk önizlemesi özgün medyada 5,395 sn, 360p proxy ile 4,679 sn sürdü. Proxy’de yeniden örnekleme ve kodlama nedeniyle kare pikselleri değişir. Tam MP4 testi, proxy çözümleyicisini çağırmadan özgün medyayı kullandığını doğruladı.
- 10 sn 4K H.264 kaynak RTX 4060 üzerinde CUDA ile çözüldü, 960×540 olarak NVENC ile 2,599 sn’de tamamlandı. Kullanılamayan bir çözme yolu için ayrı test gerçek CPU kodlamasına döndü. CUDA çözme ve NVENC kodlama farklı aşamalardır. Katmanlı efektler FFmpeg’in CPU filtrelerini kullanabilir.
- Windows arayüz kontrolünde 540p proxy oynarken süre korundu. Dört saniyelik birleşik önizleme 3.745 ms’de açıldı. Başka bir aralıktan dönüldüğünde 338 ms’de açıldı. Video oynatıcısı 2,01 saniyeye kadar 57 video karesi ve 0 düşen kare saydı. Bu sayaç tüm 20 saniyelik projeyi kapsamaz.
- Sessiz test videosundan 720×1280 Shorts üretimi v21’de 5,57 sn ve v22’de 6,70 sn süren ilgili testler içinde doğrulandı. Bu süreler kurulum, analiz ve çıktı doğrulamayı içerir. Türkçe Whisper örneği GPU’da 3.724 → 3.000 ms, İngilizce örnek CPU’da 2.578 → 2.222 ms sürdü. Aynı örneklerde kelime hata sayıları sırasıyla 2/15 ve 0/18, ilk kelime zaman hataları 20 ve 10 ms idi. Ölçüm tek koşu ve farklı anlık sistem yükü içerir.

## Sınırlar

Windows Job Object ile test süreci ve alt süreçlerine 8.192 MiB tahsis edilmiş bellek sınırı uygulandı. Electron akışı, 20 sn MP4, proxy, geri açma ve AI aktarımı tamamlandı. Windows bu grup için 1.080,5 MiB tepe tahsis bildirdi. Ayrı bir test, zamanlayıcıya 8 GiB toplam ve 512 MiB boş bellek vererek bekletme ve iptali sınadı. Her iki sınama 15,93 GiB kullanılabilir RAM’i olan Windows 11 bilgisayarda gerçekleşti. [Windows Job Object bellek ölçümü](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)

Windows 10, fiziksel 8 GB, 30 dakika kesintisiz önizleme, tam uzunlukta 4K dışa aktarma ve uygulama dışı yük altında uzun süreli test bekliyor. Önizleme render tabanlıdır. v21 efekt ve alfa geçişlerinin tamamını koruyacak gerçek zamanlı GPU bileşimi bu sürüme dahil değildir. GPU filtrelerine geçişte gerekli olabilecek ana bellek ve GPU belleği aktarımları ayrı ölçüm gerektirir. [NVIDIA FFmpeg donanım hızlandırma rehberi](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html)

Ölçümleri tekrarlamak için aynı veri klasörüyle `node scripts/benchmark-v22.mjs DEPO VERI_KLASORU` çalıştır. Çalıştırma FFmpeg, FFprobe ve NVENC uyumlu sürücü gerektirir. 500 klip arayüz koşusu `scripts/test-v19-desktop.mjs`, Windows bellek sınırı koşusu `scripts/verify-v22-memory-limit.ps1` içindedir.
