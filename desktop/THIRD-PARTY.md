# ViralCut AI Desktop — üçüncü taraf bileşenler

## FFmpeg ve FFprobe

Windows dosyaları, Gyan tarafından yayımlanan **FFmpeg 9.0.1 full build** paketinden gelir. ViralCut araçları ayrı programlar olarak çalıştırır. FFmpeg bileşeninin lisansı GPL-3.0 veya üzeridir.

- [Gyan 9.0.1 yayını ve özgün ikili dosyalar](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.1)
- [Yayıncının belirttiği FFmpeg kaynak revizyonu](https://github.com/FFmpeg/FFmpeg/commit/bf1b838f2a)
- Paket kaynakları içindeki `licenses` klasöründe GPL metni, aynı FFmpeg revizyonunun kaynak arşivi, yapılandırma çıktısı ve Gyan'ın kitaplık sürümleri listesi bulunur. Gyan derlemesi ViralCut tarafından değiştirilmemiştir.

## Whisper.cpp

Paket, [b5454 Windows x64 CPU arşivindeki](https://github.com/ggml-org/whisper.cpp/releases/tag/b5454) Whisper 1.9.5 ve GGML çalışma dosyalarını içerir. MIT lisans bildirimi paket içindeki `licenses` klasöründedir. Whisper arşivindeki SDL2 için zlib bildirimi de aynı klasördedir. Yerel CUDA motoru ve model dosyası ayrı kurulur.

## Electron

Electron MIT lisansı ve Chromium üçüncü taraf bildirimleri Electron'un dağıtımıyla birlikte gelir.
# Semantik analiz

`multilingual-e5-small` MIT lisanslıdır. Kullanılan ONNX paketi, `Xenova/multilingual-e5-small` deposunun `761b726dd34fb83930e26aab4e9ac3899aa1fa78` sürümüdür. Ağırlıklar uygulama paketlerinin dışında tutulur. [Model kartı](https://huggingface.co/intfloat/multilingual-e5-small)

ONNX Runtime Node 1.31.1 MIT lisanslı, Tokenizers.js 0.2.0 Apache-2.0 lisanslıdır. [ONNX Runtime lisansı](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) · [Tokenizers.js lisansı](https://github.com/huggingface/tokenizers.js/blob/main/LICENSE)
