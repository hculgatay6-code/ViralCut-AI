param([switch]$ApproveDownload)

$ErrorActionPreference = 'Stop'
if (-not $ApproveDownload) {
    $answer = Read-Host 'Yerel semantik analiz icin 135 MB civari model ve tokenizer indirilsin mi? (E/H)'
    if ($answer -notmatch '^[eE]$') { return }
}

$revision = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
$url = "https://huggingface.co/Xenova/multilingual-e5-small/resolve/$revision"
$directory = Join-Path $env:LOCALAPPDATA 'ViralCutAI/semantic-e5-small'
$assets = @(
    @{ Remote = 'onnx/model_uint8.onnx'; Hash = 'EE13574A23E4384619A172D4C0C8C6B825528FDE30258C56130D5E3EFCC9C8F1' },
    @{ Remote = 'tokenizer.json'; Hash = '0B44A9D7B51C3C62626640CDA0E2C2F70FDACDC25BBBD68038369D14EBDF4C39' },
    @{ Remote = 'tokenizer_config.json'; Hash = 'A1D6BC8734A6F635DC158508BEF000F8E2E5A759C7D92F984B2C86E5FF53425B' }
)
New-Item -Force -ItemType Directory -Path $directory | Out-Null
foreach ($asset in $assets) {
    $name = Split-Path -Leaf $asset.Remote
    $target = Join-Path $directory $name
    if (Test-Path -LiteralPath $target) {
        if ((Get-FileHash -LiteralPath $target).Hash -eq $asset.Hash) { continue }
        throw "Mevcut dosya dogrulanamadi: $target. Yeniden indirmek icin once bu dosyayi baska bir konuma tasi."
    }
    $temporary = Join-Path $directory ([Guid]::NewGuid().ToString() + '.part')
    try {
        curl.exe -fLsS --retry 2 --max-time 300 "$url/$($asset.Remote)?download=true" -o $temporary
        if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $temporary).Hash -ne $asset.Hash) {
            throw "Indirme dogrulanamadi: $name"
        }
        Move-Item -LiteralPath $temporary -Destination $target
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
}
Write-Output "Semantik model hazir: $directory"
