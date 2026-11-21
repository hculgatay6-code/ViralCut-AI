# ViralCut AI v22.0.0 test raporu

Taban `feature/v21-effects-studio` dalındaki `6f7a839346ead21c88b144611504b49be92a8d34` commit’idir. Bu çalışmada README, v19–v21 raporları, paket kilidi, güvenlik belgeleri, Electron dosya köprüsü, katmanlı FFmpeg, model doğrulaması, AI kesim planı ve otomatik test girişleri incelendi.

## Sonuçlar

| Kontrol | Durum |
| --- | --- |
| v21 başlangıç koşusu | 99 geçti, 0 başarısız, 0 atlanan |
| v22 yerel otomatik test | 105 geçti, 0 başarısız, 0 atlanan |
| TypeScript, Vite, Oxlint | Geçti. Vite ana arayüz paketi için boyut uyarısı verdi |
| Proxy disk ve kaynak güvenliği | Üç çözünürlük, süre/kare sayısı, ses başlangıcı, portre/sessiz video, disk ön kontrolü, iptal ve yeniden deneme doğrulandı |
| Proxy ve orijinal | Önbellek oturumlar arasında açıldı. Özgün dosyanın zaman damgası değişince eski proxy tekrar kullanılmadı. Kaynak dosyanın değişmeden kaldığı doğrulandı |
| Önizleme ve çıktı | Efekt, çapraz çözünme ve altyazı içeren kare aralığı önbellekten oynatıldı. Eksik proxy’de özgün kaynak kullanıldı. Tam MP4 kaydı proxy çözümleyicisine başvurmadı |
| A/V ve FFprobe | 3 sn katmanlı H.264/AAC çıktı 90 kareydi. Ses ve video akış süreleri arasındaki fark 35 ms’den azdı. Test edilen proxy’lerde ses başlangıcı farkı 10 ms’den azdı |
| RTX 4060 ve CPU | RTX 4060 üzerinde CUDA çözme ve NVENC kodlama çalıştı. Kontrollü çözme hatasından sonra aynı işlem gerçek CPU proxy’si üretti |
| Proje güvenliği | v1/v2/v3/v4 bağlantıları, bozuk proje reddi, otomatik kayıt/kurtarma, eski efekt ve animasyonlar mevcut regresyon testlerinde çalıştı |
| AI ve Shorts | Gerçek Whisper TR/EN ve yerel E5 çalıştı. Sessiz kaynak dikey MP4 üretti. Onaylanan kesim, altyazı ve sessizlik aralıkları düzenlenebilir proje haline geldi |
| Ses Stüdyosu | Seçili aralıktan LUFS/dBTP ölçüldü. Ses parçası olmayan kaynak anlaşılır hata verdi. Windows arayüzünde dengeleme ve özgün sese dönme denendi |
| Windows arayüzü | Proxy/orijinal geçişi, zaman çizelgesi ve önizleme imleci, ikinci aralığa gidip önbelleğe dönüş, MP4 kaydı, kapanış, yeniden açma, eksik proxy ve AI planı geri alma/yineleme doğrulandı |
| Paketlenmiş Windows editörü | Aynı arayüz akışı paket içindeki EXE ile geçti. 20 sn 1080p dosyada 600 video karesi, H.264 ve AAC ile ses ve video süresi 20,000 sn |
| Yerel kurulum dosyaları | x64 Setup ve Portable NSIS arşivleri bütünlük testinden geçti. SHA-256 yan dosyası oluşturuldu. Setup kurulum sihirbazı ve kaldırma akışı çalıştırılmadı |
| Portable EXE | Temiz profil ve uygulama arama yolunda harici Node.js olmadan açıldı. Açılış ve çıkarma 14,4 sn sürdü. Paket içi FFmpeg ile işlenmiş önizleme oynatıldı. Kapanınca yerel sunucu durdu |
| 8 GiB süreç sınırı | Windows Job Object altında arayüz senaryosu geçti. 1.080,5 MiB tepe tahsis. Fiziksel bilgisayarda 15,93 GiB kullanılabilir RAM vardı |

İlk doğrulamada test seçicileri başka bir ses kontrolüyle eşleşti ve eski pencereye bağlı kaldı. Seçiciler panel ve pencereyle sınırlandı, senaryo yeniden çalıştırıldı. İlk ses ölçümü FFmpeg istatistik aralığının yazımı nedeniyle başarısızdı. Yazım düzeltildi ve gerçek MP4 ses akışıyla tekrar ölçüldü.

İlk GitHub v22 koşusu, FFmpeg’in güncel indirme adresinden gelen arşivin beklenen SHA-256 ile eşleşmemesi üzerine durdu. CI adresi, aynı kontrol toplamına sahip sürümlü 9.0.2 arşivine sabitlendi. [İlk koşu](https://github.com/hculgatay6-code/ViralCut-AI/actions/runs/44849766006) · [Gyan 9.0.2](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2)

## Lisans ve güvenlik

- Electron sandbox ve context isolation açık, renderer Node entegrasyonu kapalı. Önizleme IPC’si kayıtlı medya kimliği ve üç sayısal profil kabul eder. Ana işlem sabit dizin ve SHA-256 anahtarıyla proxy dosyasını seçer. FFmpeg argüman listesiyle, kabuk açılmadan çalışır.
- Önbellek ve geçici dosyalar kaynak videoların yanına yazılmaz. Çıktı kaydında eski kaynak koruması kullanılır. AI işlemleri yerel modeller ve mevcut bütünlük kontrolleriyle yürütülür. Yeni npm paketi eklenmedi. Üretim bağımlılıklarında çalıştırılan npm audit 0 kayıt bildirdi.
- Yerel paket Gyan FFmpeg 9.0.2 Essentials kullanır. GPL metni, FFmpeg kaynak arşivi, yapılandırma ve tedarikçi bileşen listesi paketlenir. Statik bağımlılıklar dahil eşleşen bütün kaynak ve derleme malzemelerinin kapsamı açık kaldı. Kamuya dağıtım öncesi çözüm seçenekleri [üçüncü taraf bildirimlerinde](THIRD_PARTY_NOTICES.md) yer alır.

## Sürüm sınırları

Windows 10, fiziksel 8 GB, gerçek zamanlı GPU çok katmanlı bileşim ve tam uzunlukta 4K dışa aktarma doğrulama kapsamı dışındadır. AI planı Kolay Editör dizisine eklenir. Birden çok adayın ayrı hareketli kadrajı doğrudan aday MP4 dışa aktarmada korunur. v22’de yeni bir model veya ayrı proje şeması eklenmedi.

V23 için öncelik, bir saatlik fiziksel 8 GB testi, uzun ve değişken kare hızlı gerçek videolarda proxy değerlendirmesi, profesyonel zaman çizelgesinde aday başına kadraj ve dağıtılabilir FFmpeg derlemesi için Corresponding Source kapsamının tamamlanmasıdır.

## Dosyalar

- Proxy ve önizleme motoru. `server/proxy-cache.mjs`, `server/preview.mjs`, `server/export.mjs`, `server/layers.mjs`, `server/media.mjs`, `server/resource-budget.mjs`.
- Windows ve tanılama. `desktop/main.mjs`, `desktop/preload.cjs`, `desktop/performance.mjs`, `desktop/diagnostics.mjs`, `electron-builder.yml`, `package.json`, `package-lock.json`.
- Editör, AI ve ses. `src/App.tsx`, `src/styles.css`, `src/project/LayerOutput.tsx`, `src/project/MediaPreparation.tsx`, `src/project/ProjectPanel.tsx`, `src/project/model.ts`, `src/export/client.ts`, `src/editor/approved-shorts.ts`, `src/editor/AutoShortsPanel.tsx`, `src/editor/DirectorPanel.tsx`, `src/editor/AudioInspector.tsx`, `src/editor/PerformanceCenter.tsx`, `server/shorts-batch.mjs`, `server/studio-audio.mjs`, `server/visual-ranking.mjs`.
- Test ve sürekli entegrasyon. `tests/v22-studio.test.mjs`, `scripts/benchmark-v22.mjs`, `scripts/verify-v22-studio.mjs`, `scripts/verify-v22-hardware.mjs`, `scripts/verify-v22-portable.mjs`, `scripts/verify-v22-memory-limit.ps1`, `.github/workflows/windows-beta.yml`.
- Rehber ve rapor. `README.md`, `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md`, `V22_KULLANIM_KILAVUZU.md`, `V22_PERFORMANCE_RAPORU.md` ve bu rapor.
