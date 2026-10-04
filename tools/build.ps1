# Runs tools/gen.mjs, then assembles toywars.asm with DASM into toywars.bin
# (plus listing and symbols in tools/build). DASM runs in a temp folder
# because Windows' Controlled Folder Access stops it writing under Documents.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Force $out | Out-Null
Push-Location $root
try { node tools/gen.mjs; if ($LASTEXITCODE -ne 0) { throw 'gen failed' } } finally { Pop-Location }
$tmp = Join-Path ([IO.Path]::GetTempPath()) 'toywars-build'
New-Item -ItemType Directory -Force (Join-Path $tmp 'gen') | Out-Null
Copy-Item (Join-Path $root 'toywars.asm') $tmp -Force
Copy-Item (Join-Path $PSScriptRoot 'dasm\vcs.h') $tmp -Force
Copy-Item (Join-Path $root 'gen\*.inc') (Join-Path $tmp 'gen') -Force
Push-Location $tmp
try {
  $dasmArgs = @('toywars.asm', '-f3', '-otoywars.bin', '-ltoywars.lst', '-stoywars.sym')
  & (Join-Path $PSScriptRoot 'dasm\dasm.exe') @dasmArgs
  if ($LASTEXITCODE -ne 0) { throw "DASM failed ($LASTEXITCODE)" }
} finally { Pop-Location }
Copy-Item (Join-Path $tmp 'toywars.lst'), (Join-Path $tmp 'toywars.sym') $out -Force
Copy-Item (Join-Path $tmp 'toywars.bin') (Join-Path $root 'toywars.bin') -Force
"OK: toywars.bin"
