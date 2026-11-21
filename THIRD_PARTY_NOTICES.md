# Third-party notices / Üçüncü taraf bileşenleri

This file covers the published Windows v18.1 Beta packages. It also identifies the components selected for the local v18.1.1-beta validation candidate. Application code is covered by [LICENSE](LICENSE). Each third-party component retains its own terms.

## Windows package inventory

| Component | Published version and license | Source and notices |
| --- | --- | --- |
| Electron / Chromium | Electron 45.3.2 (MIT), Chromium 156.0.8078.100 and bundled components (multiple licenses) | [Electron release](https://github.com/electron/electron/releases/tag/v45.3.2). See `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the Windows EXE. This includes Chromium’s media library, separate from the FFmpeg tools below. |
| FFmpeg and FFprobe | Gyan Windows 9.0.1 full static build, marked GPLv3 | [Vendor](https://www.gyan.dev/ffmpeg/builds/) · [FFmpeg commit identified by vendor](https://github.com/FFmpeg/FFmpeg/commit/bf1b838f2a). The original package has the GPL text, upstream source snapshot, build flags and vendor inventory under `resources/licenses`. |
| Whisper.cpp and SDL2 | Whisper.cpp b5454 (MIT) and bundled SDL2 (zlib) | [Whisper.cpp source and binary release](https://github.com/ggml-org/whisper.cpp/releases/tag/b5454) · [SDL source](https://github.com/libsdl-org/SDL). Notices are under `resources/licenses`. |
| ONNX Runtime | onnxruntime-node and onnxruntime-common 1.31.1 (MIT) | [ONNX Runtime](https://github.com/microsoft/onnxruntime). The Windows x64 package includes native ONNX libraries. Optional execution providers depend on installed system runtimes. |
| Tokenizers | @huggingface/tokenizers 0.2.0 (Apache-2.0) | [Tokenizers](https://github.com/huggingface/tokenizers). |
| React and icons | React / React DOM 19.3.1 (MIT) and Lucide React 1.72.0 (ISC) | [React](https://github.com/facebook/react) · [Lucide](https://github.com/lucide-icons/lucide). |
| Fonts | Geist 5.3.0 and IBM Plex Mono 5.3.0 (OFL-1.1) | [Geist](https://github.com/vercel/geist-font) · [IBM Plex](https://github.com/IBM/plex). Windows fonts used for captions remain system resources. |
| npm runtime dependencies | Additional runtime modules and notices | See [packaged npm inventory](docs/PACKAGED_DEPENDENCIES.md) and the lockfile in the source distribution. |

## Optional AI models

These files are obtained separately. They are absent from the published Windows installers.

| Model | License and source |
| --- | --- |
| Whisper Base Q5 | MIT, [Whisper source](https://github.com/openai/whisper), [Whisper.cpp model repository](https://huggingface.co/ggerganov/whisper.cpp) |
| Multilingual E5 Small | MIT, [upstream model](https://huggingface.co/intfloat/multilingual-e5-small), [ONNX conversion](https://huggingface.co/Xenova/multilingual-e5-small) |
| SSD MobileNet V1 INT8 | Apache-2.0, [model card](https://huggingface.co/onnxmodelzoo/ssd_mobilenet_v1_12-int8) |
| Ultra-Light Slim | MIT, [model source](https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB) |

The local setup scripts check pinned SHA-256 values. The app does not download models as part of startup.

## FFmpeg distribution status / Dağıtım durumu

The published executables report `--enable-gpl`, `--enable-version3`, and `--enable-static`. The Gyan full build enables many external components, including x264, x265, libass, FreeType, HarfBuzz, GnuTLS, and FFmpeg’s built-in Whisper integration. The vendor README supplied in the package lists additional components and versions. The app invokes the command-line tools as separate processes.

The existing upstream FFmpeg snapshot and configure flags do not establish a complete Corresponding Source offer for the delivered static binaries. The unresolved scope is the exact source of linked non-system libraries and the build scripts, patches, and installation information required for the relevant distribution. The GPL text and copyright notices must accompany the covered work. Corresponding Source needs to be offered in accordance with the license. A complete source set and any applicable notice requirements have not been verified. [FFmpeg license guidance](https://ffmpeg.org/legal.html) · [GPLv3, §§1 and 6](https://www.gnu.org/licenses/gpl-3.0.html)

The local v18.1.1-beta candidate uses the vendor’s 9.0.2 Essentials ZIP, SHA-256 `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`. It is a smaller GPL-enabled build. Its included FFmpeg upstream source, license, flags and supplier README are provided as evidence. Corresponding-source coverage for that binary is still open. A future distributable package should use a build with a verified, complete source and build-material bundle that recipients can access. This is also an item for legal review before further distribution. [Vendor downloads](https://www.gyan.dev/ffmpeg/builds/) · [FFmpeg 9.0.2 source](https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz)

### v22 local validation package

The Windows validation package uses the same Gyan 9.0.2 Essentials binaries, exposed to the editor as local child processes. The table identifies the binaries and the available upstream snapshot.

| File | SHA-256 |
| --- | --- |
| ffmpeg.exe | `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec` |
| ffprobe.exe | `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52` |
| ffmpeg-9.0.2.tar.xz | `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e` |

The executable reports the GPL, version 3 and static build flags. The configuration includes libx264, libx265, libass and NVIDIA encoding. The package contains the upstream FFmpeg snapshot, GPL text, configuration and vendor inventory. The inventory identifies components including x264 and libass. The complete matching source, patches and scripts for the linked non-system components have yet to be verified. Before redistribution, obtain a complete Corresponding Source bundle for these binaries or build and document independently reproducible equivalents. Validate the license notices and source delivery method for the resulting package. [FFmpeg license guidance](https://ffmpeg.org/legal.html) · [GPLv3 sections 1 and 6](https://www.gnu.org/licenses/gpl-3.0.html)

The application keeps the licensing of the existing Electron, Whisper, ONNX Runtime and font distributions. v22 adds no npm dependency and uses the previously supported local models.
