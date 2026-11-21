# ViralCut AI v23.0.0 test raporu

Taban, yerel ve uzak v22 dalında doğrulanan `61cc9c6e1479dba1a3f6b7159ca4000ed00d8091` commit’idir. v22 başlangıç koşusunda 105 test geçti, başarısız ve atlanan test yoktu.

## Doğrulamalar

Son yerel v23 koşusunda **107 test geçti**, başarısız veya atlanan test yoktu. Çalışma alanı senaryosu hem geliştirme sürümünde hem paketlenmiş Windows editöründe ayrı çalıştırıldı.

- TypeScript, Vite üretim derlemesi ve Oxlint.
- Electron’da üç çalışma alanı, klavyeyle panel boyutlandırma, panel görünürlüğü, tema ve dilin kapanıp açılınca korunması. 1366×768 ve 1920×1080 pencere hedeflerinde Electron %100, %125, %150 yakınlaştırma ayarı ile görünürlük ve taşma kontrolü. Bu ölçek koşuları Windows’un DPI ayarını değiştirmedi.
- Proje kaydetme, arama, son projeden yeniden açma ve kirli projeyi değiştirme uyarısında iptal. Eski proje şemaları ve kurtarma önceki testlerle kontrol edildi.
- Kare imleci, klavye odağı ve normal düzenleme. Uzun projelerde sabit yakınlaştırma alt sınırı kaldırıldı. 30. dakikadaki klip sığdırma sonrasında görünür alanın içine geldi. Ayrıca 500 klip ve 45 kaydırma örneği ölçüldü.
- v22 proxy/orijinal geçişi, kayıp proxy’de geri dönüş, birleşik önizleme önbelleği, AI önerisinin onayla aktarılması ve geri alınması.
- 20 saniyelik 1920×1080 MP4 dosyasında 600 H.264 video karesi ve AAC akışı. FFprobe ses ve video akışlarının süresini ayrı ayrı 20,000 saniye ölçtü.
- Başlangıçta, debounced tercih yazımı ile kapanış arasında son panel ayarı kaybolabiliyordu. Kapanışta tercihin diske yazılması beklenerek düzeltildi ve senaryo hemen kapatılıp yeniden açılarak doğrulandı.

## Güvenlik ve uyumluluk

- Son projelerin yolları ana süreçteki profil dosyasında kalır. Renderer yalnızca kayıt kimliği ve dosya adını alır. Dosya açma, mevcut yerel proje ve medya doğrulamalarını kullanır. Proje şeması v1–v4 olarak kalır.
- Sandbox, context isolation, kayıtlı medya ve mevcut FFmpeg komut sınırları korunur. Yeni npm paketi veya ağ hizmeti eklenmedi. Ayrı v23 profilinde önizleme önbelleği yeniden oluşur.
- FFmpeg statik bağımlılıklarının Corresponding Source kapsamı açıktır. Durum [üçüncü taraf bildirimlerinde](THIRD_PARTY_NOTICES.md) ele alınmıştır. Kurulum paketleri yerel doğrulama içindir.

## Açık kalanlar

Fiziksel Windows 10/8 GB, işletim sistemi DPI değişimi ve kapsamlı erişilebilirlik denetimi bekliyor. Kütüphane video, ses, altyazılı kaynak ve eksik dosya filtreleri sunar. Bağımsız görsel dosya içe aktarma hattı yoktur. Yapay zekâ ve platform paketleri mevcut araçları kullanır. Canlı sosyal medya yüklemesi bu sürümde denenmedi.

V24 için öneriler, fiziksel 8 GB üzerinde uzun süreli oturum testi, yüksek sistem yükündeki kaydırma gecikmelerinin incelenmesi ve doğrulanabilir FFmpeg kaynak/derleme dağıtımıdır.

## Değiştirilen alanlar

- Çalışma alanı ve proje merkezi. `desktop/workspace.mjs`, `desktop/main.mjs`, `desktop/preload.cjs`, `desktop/beta.mjs`, `src/App.tsx`, `src/project/ProjectPanel.tsx`, `src/project/model.ts`.
- Medya, zaman çizelgesi ve dışa aktarma. `src/project/MediaLibrary.tsx`, `src/project/LayeredTimeline.tsx`, `src/project/LayerOutput.tsx`, `src/styles.css`.
- Windows, test ve belgeler. Paket sürüm dosyaları, `.github/workflows/windows-beta.yml`, `tests/workspace.test.mjs`, `scripts/verify-v23-workspace.mjs`, Portable doğrulayıcısı, README, CHANGELOG, raporlar ve iki uygulama görüntüsü.
