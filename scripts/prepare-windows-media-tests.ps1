$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("viralcut-test-tools-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $scratch | Out-Null

function Get-VerifiedArchive([string]$Url, [string]$File, [string]$Sha256) {
  Invoke-WebRequest -Uri $Url -OutFile $File
  if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Sha256) {
    throw "Test runtime checksum mismatch: $([System.IO.Path]::GetFileName($File))"
  }
}

$mediaArchive = Join-Path $scratch 'ffmpeg.zip'
Get-VerifiedArchive 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip' $mediaArchive '60F467265B1E312373DBCD92200C2618A74850F98D3D078E94296BB3FA2047BA'
Expand-Archive -LiteralPath $mediaArchive -DestinationPath $scratch
$bins = Join-Path $scratch 'ffmpeg-9.0.2-essentials_build/bin'
$mediaTarget = Join-Path $workspace 'desktop-resources/ffmpeg'
New-Item -ItemType Directory -Path $mediaTarget -Force | Out-Null
# Browser tests use PATH. Electron only loads the executables from desktop-resources.
foreach ($file in @('ffmpeg.exe', 'ffprobe.exe')) {
  Copy-Item -LiteralPath (Join-Path $bins $file) -Destination $mediaTarget
}
if ($env:GITHUB_PATH) { $mediaTarget | Out-File -FilePath $env:GITHUB_PATH -Append -Encoding utf8 }

$whisperArchive = Join-Path $scratch 'whisper.zip'
Get-VerifiedArchive 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip' $whisperArchive '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb'
# The engine avoids a modal startup warning during Electron tests. Models are optional.
Expand-Archive -LiteralPath $whisperArchive -DestinationPath (Join-Path $workspace 'desktop-resources/whisper')
Write-Host "Verified FFmpeg, FFprobe and Whisper.cpp test runtimes prepared."
