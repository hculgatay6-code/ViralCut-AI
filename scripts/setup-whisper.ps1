param([switch]$Cpu, [switch]$Model, [switch]$CudaLibraries, [string]$CudaArchive)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'ViralCutAI'
New-Item -ItemType Directory -Force -Path $root | Out-Null
if ($CudaLibraries) {
  $engine = Get-ChildItem -LiteralPath (Join-Path $root 'whisper-cuda') -Recurse -Filter whisper-cli.exe | Select-Object -First 1
  if (!$engine) { throw 'Once CUDA Whisper motorunu kurun.' }
  $target = $engine.DirectoryName
  if ((Test-Path (Join-Path $target 'cublas64_11.dll')) -and (Test-Path (Join-Path $target 'cublasLt64_11.dll'))) { exit 0 }
  $archive = if ($CudaArchive) { (Resolve-Path -LiteralPath $CudaArchive).Path } else { Join-Path $root ('cublas-' + [Guid]::NewGuid() + '.whl') }
  try {
    $url = 'https://files.pythonhosted.org/packages/0b/1d/7a78cd36fd5e3da4021b3ac2c2c8b2651dd72345b7c3ecc0d3e051884f50/nvidia_cublas_cu11-11.11.3.6-py3-none-win_amd64.whl'
    if (!$CudaArchive) {
      & curl.exe -fsSL --connect-timeout 15 --speed-limit 16384 --speed-time 30 --retry 2 $url -o $archive
      if ($LASTEXITCODE -ne 0) { throw 'NVIDIA cuBLAS indirilemedi.' }
    }
    if ((Get-FileHash -LiteralPath $archive).Hash -ne '6ab12b1302bef8ac1ff4414edd1c059e57f4833abef9151683fb8f4de25900be') {
      throw 'NVIDIA cuBLAS dosyasi dogrulanamadi.'
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
      foreach ($name in @('cublas64_11.dll', 'cublasLt64_11.dll')) {
        $entry = $zip.Entries | Where-Object { $_.FullName.EndsWith('/bin/' + $name) } | Select-Object -First 1
        if (!$entry) { throw "DLL eksik: $name" }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $target $name), $true)
      }
    } finally { $zip.Dispose() }
  } finally {
    if (!$CudaArchive -and (Test-Path -LiteralPath $archive)) { Remove-Item -LiteralPath $archive }
  }
  exit 0
}
if ($Model) {
  $reply = Read-Host 'Cok dilli Whisper Base Q5 modeli (57 MiB) indirilsin mi? Evet icin E yazin'
  if ($reply -notmatch '^[Ee]$') { exit 0 }
  $path = Join-Path $root 'ggml-base-q5_1.bin'
  $expected = '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898'
  if ((Test-Path -LiteralPath $path) -and (Get-FileHash -LiteralPath $path).Hash -eq $expected) {
    Write-Host 'Model hazir.'
    exit 0
  }
  $part = $path + '.' + [Guid]::NewGuid() + '.part'
  try {
    $url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/f281eb45af861ab5e5297d23694b7d46e090c02c/ggml-base-q5_1.bin?download=true'
    & curl.exe -fsSL --retry 2 $url -o $part
    if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $part).Hash -ne $expected) { throw 'Model dogrulanamadi.' }
    Move-Item -LiteralPath $part -Destination $path -Force
    Write-Host 'Model hazir.'
  } finally {
    if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part }
  }
  exit 0
}
$tag = 'b5454'
$asset = 'whisper-bin-win-cuda-11.8.0-x64.zip'
$sha = 'e81c86c542be6e3d7b7245392d4e1c52ab6e5c61dbe38721754bc0ab59d4d027'
$target = Join-Path $root 'whisper-cuda'
if ($Cpu) {
  $asset = 'whisper-bin-x64.zip'
  $sha = '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb'
  $target = Join-Path $root 'whisper-cpu'
}
if (Test-Path -LiteralPath $target) { throw "Whisper klasoru zaten var: $target" }
$archive = Join-Path $root ($asset + '.zip')
try {
  $url = "https://github.com/ggml-org/whisper.cpp/releases/download/$tag/$asset"
  & curl.exe -fsSL --retry 2 $url -o $archive
  if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $archive).Hash -ne $sha) { throw 'Whisper paketi dogrulanamadi.' }
  Expand-Archive -LiteralPath $archive -DestinationPath $target
  Get-ChildItem -LiteralPath $target -Recurse -Filter whisper-cli.exe | Select-Object -ExpandProperty FullName
} finally {
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
}
