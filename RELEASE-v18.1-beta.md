# ViralCut AI v18.1 Beta — kapalı beta taslağı

Önerilen dal `beta/v18.1`, etiket `v18.1-beta`, uygulama sürümü `18.1.0-beta`. GitHub Release oluşturulurken taslak ve ön sürüm olarak işaretlenir. Güncel GitHub deposu ve izni doğrulandıktan sonra ilk 10–20 katılımcıya erişim verilir.

## Kurulum

1. `ViralCut-AI-v18.1-beta-Setup.exe` ve `SHA256SUMS-v18.1-beta.txt` dosyalarını al.
2. Kurulum dosyasının SHA-256 değerini kontrol et. Windows PowerShell komutu `Get-FileHash .\ViralCut-AI-v18.1-beta-Setup.exe -Algorithm SHA256`.
3. Setup dosyasını aç veya kurulumsuz kullanım için `ViralCut-AI-v18.1-beta-Portable.exe` dosyasını çalıştır.
4. Altyazı için doğrulanmış Whisper Base Q5 modelini **Altyazı** bölümünden seç. İsteğe bağlı yerel görsel/semantik modelleri mevcut kurulum adımlarıyla edin.

## Beta testinde denenecekler

- Açılış, sesli ve sessiz video, kesme, önizleme, Türkçe altyazı, proje açma ve kaydetme.
- Bir proje düzenleyip otomatik kayıt bildirimini bekle. Uygulamayı yeniden aç ve kurtarma seçeneğini dene.
- MP4 dışa aktar ve görüntü/sesi oynat. İptal ve hatalı kaynak akışını dene.
- Ayarlara depo adını gir. Hata raporu gerekirse önce yerel JSON dosyasını açıp içeriğini incele, ardından kapalı deponun Issues bölümünde kendin paylaş.

## Bilinen sınırlar

Windows 10 ve 8 GB RAM için katılımcı doğrulaması bekleniyor. Paket imzasızdır. Uygulama güncelleme yüklemez. Özel deponun sürümleri oturum açık GitHub tarayıcısından incelenebilir. Anonim otomatik kontrol özel sürümleri göremez. Sosyal medya yetkileri v18 kapsamındadır. Gerçek canlı yayın testleri bu beta kapsamında tamamlanmadı.

Release varlıkları Setup, Portable ve SHA256SUMS dosyalarıdır. Paketli FFmpeg derlemesi için dağıtım ve kaynak yükümlülüklerini üçüncü taraf notlarına göre kontrol et.
