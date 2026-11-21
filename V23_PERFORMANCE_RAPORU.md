# ViralCut AI v23.0.0 performans ölçümü

Windows 11 Home Insider Preview 26340, Ryzen 5 5600, yaklaşık 16 GB sistem RAM’i ve RTX 4060. v22 ve v23’te 20 katman ve 500 klip içeren mevcut Electron senaryosu kullanıldı. 45 örnekte kaydırma komutundan iki animasyon karesi sonrasına kadar geçen süre ölçüldü.

| Ölçüm | v22 | v23 |
| --- | ---: | ---: |
| 500 klibi açıp zaman çizelgesini gösterme | 257,0 ms | 480,0 ms |
| Kaydırma medyanı | 12,1 ms | 12,2 ms |
| En uzun kaydırma örneği | 13,6 ms | 178,2 ms |
| Renderer çalışma kümesi | 138,4 MiB | 142,2 MiB |
| Kaydırma ölçümünde Electron CPU süresi | 0,736 CPU-sn | 0,744 CPU-sn |

v23 ölçümünde Windows paketleme arka planda çalışıyordu. Açılış ve en uzun kaydırma daha yavaş ölçüldü. Bu tek koşu, farkın uygulama kodundan ne kadarının kaynaklandığını belirlemeye yetmez.

Windows Job Object ile uygulama ve test alt süreçlerine **8.192 MiB** tahsis sınırı uygulandı. 540p proxy/orijinal geçişi, 20 saniyelik MP4 dışa aktarma, yeniden açma ve AI planı aktarımı tamamlandı. **1.091,9 MiB** tepe tahsis ölçüldü. Aynı koşuda 4 saniyelik işlenmiş önizleme 3.762 ms, önbellekten dönüş 356 ms sürdü. Ölçülen kısa oynatımda 58 kare ve 0 düşen kare kaydedildi.

GPU/VRAM için yeni karşılaştırmalı örnekleme yapılmadı. v23 regresyonunda RTX 4060 ile NVENC çıktıları üretildi. Fiziksel 8 GB ortamında, Windows 10’da veya uzun oturumda ayrı ölçüm yapılmadı.
