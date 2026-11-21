# ViralCut AI v24 performans raporu

Ölçüm ortamı Windows 11 Home Insider Preview (26340), Ryzen 5 5600, 16 GB sistem RAM’i ve RTX 4060 (8188 MiB VRAM, NVIDIA 610.88). Aynı kaynakları ve ayarları kullanan `scripts/benchmark-v22.mjs` önce v23, ardından v24 koduyla çalıştırıldı. Test kaynakları sentetik hareketli görüntü ve ton içerir. Katmanlı kompozisyonda beş efekt, 720p ve 30 FPS kullanıldı. Her senaryo bir kez ölçüldü.

| Senaryo | v23 | v24 | Kodlayıcı |
| --- | ---: | ---: | --- |
| 1080p / 5 dk kaynaktan ilk 8 sn önizleme | 7.208 ms | 6.263 ms | NVENC |
| 1080p / 5 dk, aynı 8 sn aralığı önbellekten | 61 ms | 46 ms | Disk önbelleği |
| 1080p / 5 dk kaynaktan 12 sn MP4 | 8.222 ms | 8.053 ms | NVENC |
| 1080p / 5 dk, 360p proxy üretimi | 20.134 ms | 21.024 ms | CPU |
| 1080p / 5 dk, proxy’den 8 sn önizleme | 5.308 ms | 4.999 ms | NVENC |
| 1080p / 30 dk kaynaktan ilk 8 sn önizleme | 5.641 ms | 5.886 ms | NVENC |
| 1080p / 30 dk, aynı aralık önbellekten | 59 ms | 46 ms | Disk önbelleği |
| 4K / 5 dk kaynaktan ilk 8 sn önizleme | 7.714 ms | 7.470 ms | NVENC |
| 4K / 5 dk, aynı aralık önbellekten | 57 ms | 57 ms | Disk önbelleği |

| v24 ilk önizleme | Ort. sistem CPU | Tepe sistem RAM | Tepe Node RSS | Tepe GPU | Tepe VRAM |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1080p / 5 dk kaynak | %77 | 13.271 MiB | 82 MiB | %18 | 1.307 MiB |
| 1080p / 30 dk kaynak | %65 | 13.358 MiB | 88 MiB | %17 | 1.332 MiB |
| 4K / 5 dk kaynak | %68 | 13.461 MiB | 91 MiB | %27 | 1.336 MiB |

Sistem belleği ve NVIDIA ölçümleri makinedeki diğer işlemleri de kapsar. Node RSS tek başına FFmpeg veya tam Electron uygulaması belleğini kapsamaz. 1080p/5 dk v23 ilk önizlemesi %90 sistem CPU ve 13.950 MiB sistem RAM ölçtü. Arka plan yükü değiştiğinden tek tekrardan genel bir hızlanma yüzdesi çıkarılmadı. NVENC kodlama doğrulandı. Bu örneklerde donanım çözme etkinliği ölçülmedi.

v24 sentetik katmanlı otomatik kurgu testinde, 2,5 saniye ve 75 karelik 720×1280 H.264/AAC MP4’ün CPU ile hazırlanması 1.944 ms sürdü. FFprobe akış süreleri arasındaki fark 0 ms idi. Karşılaştırılan karede tam render ve aynı ayarlı aralık önizlemesinin 8 bit ortalama piksel farkı 0 çıktı.

Gerçek beş dakikalık konuşma videosunun son kurulu v24 ölçümünde yerel analiz 46,71 sn, 8 sn önizleme 6,47 sn ve 28,7 sn MP4 kaydetme 21,13 sn sürdü. Bu akışın v23 karşılığı ölçülmedi.

| 20 katman / 500 klip, 45 kaydırma ölçümü | v23 | v24 |
| --- | ---: | ---: |
| Projeyi açıp 20. katmanı gösterme | 100,0 ms | 84,5 ms |
| Kaydırma medyanı, iki animasyon karesi | 12,1 ms | 12,1 ms |
| Ölçülen azami kaydırma gecikmesi | 13,4 ms | 13,7 ms |
| Electron CPU süresi | 0,432 sn | 0,388 sn |
| Ölçüm sonunda renderer çalışma kümesi | 145,9 MiB | 144,8 MiB |

Kaydırma testi kullanıcı arayüzü ölçümüdür. v23 geliştirme çalıştırıcısı ve v24 paketli uygulama kullanıldığı için açılış farkı sürüme atfedilmedi. v22 proxy regresyonunun v24 yürütmesinde iki saniyelik oynatma örneğinde 59 kare raporlandı ve kare düşüşü 0 idi.

8.192 MiB commit sınırı uygulanan Windows Job Object içinde proxy hazırlama, önizleme, 20 saniye MP4 dışa aktarma, proje açma ve analizli klibi aktarma geçti. İşlem ağacı tepe commit’i 1.097,7 MiB idi. İki saniyelik sınırlandırılmış önizleme örneğinde 57 kare ve 4 düşen kare raporlandı. İlk deneme 120 saniyelik test zaman aşımına takıldı. Ölçümlü tekrar 210 saniyelik test zaman aşımı ayarıyla tamamlandı.

Fiziksel Windows 10 / 8 GB ortamı ve uzun süreli oynatma kare düşüşü ölçülmedi. Kaynak süreleri, önizleme testinde işlenen aralığın süresini göstermez.
