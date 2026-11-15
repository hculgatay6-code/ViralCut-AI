# Security review / Güvenlik denetimi

**Scope:** the published `v18.1-beta` tag and release assets, and the local `v18.1.1-beta` validation candidate. Review date: 2026-11-15. This report gives triage and remediation status without publishing reproduction material.

## Findings

| Severity | Area | Result and status |
| --- | --- | --- |
| Critical | Embedded credentials and history | No matching active credential or sensitive media/project artifact was identified in the scanned public refs and released source archive. The pattern scan does not prove the absence of all secrets. |
| High | Native media runtime | The published packages include FFmpeg/FFprobe 9.0.1. The local validation candidate advances to 9.0.2. The published packages still contain the older runtime. Use trusted media until an updated distributable package is approved. |
| Medium | Input and resource limits | Defensive limits on downloaded update metadata and local project reads were tightened for the candidate. The desktop startup and local session marker were hardened. Existing file compatibility and update checks were tested. |
| Low | Package authenticity | The published assets’ GitHub SHA-256 digests match the audited local installer and portable archive. The packages are unsigned. Checksums provide integrity verification and do not replace a publisher signature. |
| Low | Build reproducibility | The published source archive includes a pinned, read-only test workflow recipe. The published repository history did not include a live workflow on the default branch. The legacy recipe requires an unpublished media bundle. The candidate validation is currently local. |

The FFmpeg distribution and corresponding-source review is tracked separately in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). [FFmpeg supported downloads](https://ffmpeg.org/download.html) · [FFmpeg security notes](https://ffmpeg.org/security.html)

## What was checked

- Public Git refs, both existing commits at review time, and the 119 files in the released source archive were examined. Pattern matches in the OAuth module were parameter names and runtime handling, rather than embedded credentials. No Git history was rewritten. This review had no visibility into removed refs, external forks, or private copies.
- Electron windows were checked for sandbox and context isolation, disabled Node integration, navigation and popup restrictions, sender-scoped IPC, and narrowly authorized microphone access.
- The desktop media service is loopback-only and requires the per-session request header. Renderer requests stay on the application origin. The audit inspected validation for media and project paths, approved save destinations and FFmpeg process arguments, fixed demuxer selection, and disabled external media references. Native media decoding remains part of the attack surface.
- Update metadata comes from HTTPS GitHub endpoints and is shown as text. The app does not install downloaded updates. Local diagnostic export uses allowlisted event fields. YouTube access uses explicit OAuth and user confirmation with Windows-protected credential storage.
- npm audit reported zero advisories in both full and production dependency views at the time of the check. Native media executables, embedded Chromium, optional models and the GPU driver are outside npm audit’s coverage.
- All four published Release asset links returned HTTP 200. GitHub asset hashes and local SHA-256 checks were compared. The tag and published files were not modified.

## Validation

TypeScript, Vite and lint passed. 83 automated tests passed using the 9.0.2 media tools, including real FFmpeg exports, Turkish/English Whisper, local E5, subtitles and silence handling. Windows 10 and 8 GB hardware were not available for validation. See the [original beta report](V18_1_BETA_TEST_RAPORU.md) for tests of the published v18.1 package.

For a suspected vulnerability, use the [private disclosure policy](SECURITY.md).
