$ErrorActionPreference = 'Stop'
$quoteRoot = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $quoteRoot 'runtime'
$version = 'v24.22.2'
$archive = "node-$version-win-x64.zip"
$expected = 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$download = Join-Path $runtime $archive
Write-Host 'Downloading the official portable Node.js runtime. No system installation or paid service is required.'
Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$version/$archive" -OutFile $download -TimeoutSec 120
if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Download checksum did not match the official release. Do not use this file.' }
Expand-Archive -LiteralPath $download -DestinationPath $runtime -Force
Copy-Item -LiteralPath (Join-Path $runtime "node-$version-win-x64\node.exe") -Destination (Join-Path $runtime 'node.exe') -Force
Write-Host 'Local runtime is ready. Double-click Start-QuoteDesk.cmd.'
