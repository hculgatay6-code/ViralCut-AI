# Development / Geliştirme

Node.js 24 x64 ve Windows kullan. Yayımlanan v18.1 kaynağı sürüm sayfasındaki kaynak ZIP’te bulunur. Kaynak ağaçtan ayrı bir klasörde `npm ci` çalıştır. Test ve paketleme için yerel FFmpeg, FFprobe ve Whisper çalışma zamanı gerekir. Bu bileşenlerin kaynakları ve dağıtım durumu için [üçüncü taraf bildirimlerine](../THIRD_PARTY_NOTICES.md) bak.

```powershell
npm ci
npm run lint
npm run build
npm test -- --test-concurrency=2
```

Gerçek yerel Whisper ve E5 testlerini etkinleştirmek için daha önce doğrulanmış modellerin kurulu olduğu sistemde `VIRALCUT_SPEECH_TEST=1` ve `VIRALCUT_SEMANTIC_TEST=1` ortam değişkenlerini ayarla. Testlerde kaynak videoları veya raporları depoya ekleme.

Use Windows and Node.js 24 x64. The release includes a separate source archive. Run the commands above in the extracted source directory. FFmpeg, FFprobe and a local Whisper runtime are needed for media validation and packaging. Full AI integration tests also require previously verified local models. Keep model downloads, media, credentials, diagnostics, and build output out of Git.

The proposed Windows Actions workflow runs validation with a checksum-pinned media runtime. It does not upload installers or publish releases. If the supplier replaces the download, update the pinned version and digest after verifying the replacement. Use verified binaries and resolve corresponding-source obligations before preparing a distributable build.
