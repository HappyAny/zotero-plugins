param([switch]$UpdateManifest)
$ErrorActionPreference = "Stop"
# Compatibility metadata is always generated beside the XPI, outside source/.
& python -X utf8 (Join-Path $PSScriptRoot "../scripts/build.py")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
