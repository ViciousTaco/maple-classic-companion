# Dot-source before any npm / cargo / tauri command:   . .\dev-env.ps1
# Keeps every cache and temp file inside this project folder (the owner's requirement, 2026-10-05).
$root = $PSScriptRoot
$env:Path = "$env:LOCALAPPDATA\hermes\node;$env:Path"
$env:CARGO_HOME = "$root\.cache\cargo"                 # crate downloads
$env:npm_config_cache = "$root\.cache\npm"             # npm downloads
$env:PLAYWRIGHT_BROWSERS_PATH = "$root\.cache\ms-playwright"
$env:TEMP = "$root\.tmp"; $env:TMP = "$root\.tmp"      # compiler / linker temp files
New-Item -ItemType Directory -Force "$root\.cache", "$root\.tmp" | Out-Null
# Release exes carry no local paths: the project folder becomes "." and the crate cache "cargo" (P10).
$env:RUSTFLAGS = "-C target-feature=+crt-static --remap-path-prefix=$root\.cache\cargo=cargo --remap-path-prefix=$root=."
