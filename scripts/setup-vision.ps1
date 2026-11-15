$ErrorActionPreference = 'Stop'
$choice = Read-Host 'SSD MobileNet INT8 (9.54 MB, Apache-2.0) ve Ultra-Light Slim (1.20 MB, MIT) indirilsin mi? [E/H]'
if ($choice -notmatch '^(e|evet|y|yes)$') { exit 0 }

$folder = Join-Path $env:LOCALAPPDATA 'ViralCutAI\vision-v13'
$assets = @(
  @{File='ssd_mobilenet_v1_12-int8.onnx'; Size=9540809; Hash='2b79e6a7fb1ec6a33f332b9b10d82d9de4b7b49dcd26b5946921bb356895c954'; Url='https://huggingface.co/onnxmodelzoo/ssd_mobilenet_v1_12-int8/resolve/9296185/ssd_mobilenet_v1_12-int8.onnx'},
  @{File='version-slim-320.onnx'; Size=1195330; Hash='e9adbd0f920ddcce9368434c4d34d72520dc0c19b526fd44b4ef49bde2c3b1a8'; Url='https://raw.githubusercontent.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/dffdddda9794a50607cba8f318507a28c1c27cab/models/onnx/version-slim-320.onnx'}
)
New-Item -ItemType Directory -Path $folder -Force | Out-Null
foreach ($asset in $assets) {
  $dst = Join-Path $folder $asset.File
  if ((Test-Path -LiteralPath $dst -PathType Leaf) -and (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash -eq $asset.Hash) {
    Write-Host "Dogrulandi $($asset.File)"
    continue
  }
  $part = Join-Path $folder ('.download-' + [Guid]::NewGuid().ToString('N'))
  try {
    & curl.exe --fail --silent --show-error --location --proto '=https' --max-filesize $asset.Size --output $part $asset.Url
    if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath $part).Length -ne $asset.Size -or
        (Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash -ne $asset.Hash) { throw "Model dogrulanamadi $($asset.File)" }
    Move-Item -LiteralPath $part -Destination $dst -Force
    Write-Host "Kuruldu $($asset.File)"
  } finally {
    if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part }
  }
}
