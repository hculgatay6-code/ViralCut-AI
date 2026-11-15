param([Parameter(Mandatory)][string]$Archive, [string]$Destination = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$archivePath = (Resolve-Path -LiteralPath $Archive).Path
$hash = '54C5AC34F5D973996F9F9A959FB9A1B9EC3AC4C677EC9D41FAFCFC9A2492B671'
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $hash) { throw 'Medya araçları arşivinin SHA-256 değeri uyuşmuyor.' }
$target = (Resolve-Path -LiteralPath $Destination).Path
if (Test-Path -LiteralPath (Join-Path $target 'desktop-resources')) { throw 'Mevcut desktop-resources klasörü korunuyor.' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $target
foreach ($file in @('ffmpeg/ffmpeg.exe','ffmpeg/ffprobe.exe','whisper/whisper-cli.exe','licenses/FFmpeg-GPL-3.0.txt')) {
  if (!(Test-Path -LiteralPath (Join-Path $target "desktop-resources/$file") -PathType Leaf)) { throw "Medya aracı eksik: $file" }
}
