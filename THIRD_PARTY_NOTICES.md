# Üçüncü taraf bileşenler

| Bileşen | Kullanım | Lisans ve kaynak |
|---|---|---|
| Electron 45.3.2 ve Chromium bileşenleri | Windows çalışma zamanı | Electron MIT. Paket içindeki Electron lisansı ve Chromium bildirimleri geçerlidir. [Electron](https://github.com/electron/electron) |
| FFmpeg/FFprobe 9.0.1 | Gyan full Windows ikilileri | Derleme GPLv3 olarak etiketli. Paket, lisans ve yapılandırma bilgisiyle upstream FFmpeg kaynak arşivini taşır. [Gyan derlemesi](https://www.gyan.dev/ffmpeg/builds/) · [FFmpeg kaynak](https://github.com/FFmpeg/FFmpeg/commit/bf1b838f2a) |
| Whisper.cpp b5454 ve SDL2 | Paketli CPU konuşma tanıma motoru | MIT ve zlib. [Whisper.cpp](https://github.com/ggml-org/whisper.cpp/releases/tag/b5454) · [SDL](https://github.com/libsdl-org/SDL) |
| ONNX Runtime | Yerel çıkarım | MIT. [ONNX Runtime](https://github.com/microsoft/onnxruntime) |
| React, Geist, IBM Plex Mono | Arayüz | React MIT. Fontlar SIL Open Font License 1.1. [React](https://github.com/facebook/react) · [Geist](https://github.com/vercel/geist-font) · [IBM Plex](https://github.com/IBM/plex) |
| Whisper Base Q5 | Ayrı seçilen veya indirilen model | Whisper kaynak ve model bildirimi MIT. [Whisper](https://github.com/openai/whisper) · [GGML model kaynağı](https://huggingface.co/ggerganov/whisper.cpp) |
| Multilingual E5 Small | Ayrı indirilen semantik model | MIT. [E5 model kartı](https://huggingface.co/intfloat/multilingual-e5-small) |
| SSD MobileNet V1 INT8 | Ayrı indirilen nesne algılama modeli | Apache-2.0. [Model kartı](https://huggingface.co/onnxmodelzoo/ssd_mobilenet_v1_12-int8) |
| Ultra-Light Slim | Ayrı indirilen yüz algılama modeli | MIT. [Yüz algılama deposu](https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB) |

FFmpeg, Whisper ve SDL2 bildirimleri kurulumda `resources/licenses` altında bulunur. Modeller Setup ve Portable dosyalarına gömülmez. Yerel model kurulum betikleri sabit sürüm ve beklenen SHA-256 değerlerini denetler.

Beta ikililerini başka kişilere göndermeden önce Gyan statik derlemesinin bağlı kütüphaneleri de kapsayan karşılık gelen kaynak kodu ve dağıtım gerekliliklerini doğrula. Bu projede bulunan upstream FFmpeg arşivi tek başına bu doğrulamanın yapıldığı anlamına gelmez. [FFmpeg yasal bilgiler](https://ffmpeg.org/legal.html) · [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html)
