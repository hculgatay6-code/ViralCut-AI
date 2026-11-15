param(
  [string]$Release = (Join-Path (Split-Path -Parent $PSScriptRoot) 'release'),
  [ValidatePattern('^v\d+\.\d+(?:\.\d+)?-beta$')][string]$Tag
)

$ErrorActionPreference = 'Stop'
$folder = (Resolve-Path -LiteralPath $Release).Path
if (!$Tag) {
  $manifest = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json') -Raw | ConvertFrom-Json
  $Tag = 'v' + $manifest.version
  if ($Tag -notmatch '^v\d+\.\d+(?:\.\d+)?-beta$') { throw 'Invalid beta tag' }
}
$names = @("ViralCut-AI-$Tag-Setup.exe", "ViralCut-AI-$Tag-Portable.exe")
$lines = foreach ($name in $names) {
  $hash = (Get-FileHash -LiteralPath (Join-Path $folder $name) -Algorithm SHA256).Hash
  $hash.ToLowerInvariant() + '  ' + $name
}
$lines | Set-Content -LiteralPath (Join-Path $folder "SHA256SUMS-$Tag.txt") -Encoding ascii
