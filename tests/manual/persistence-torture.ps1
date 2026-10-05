# P2-T9 automated part: kill a process that is saving continuously, 10 times, and check the save always loads.
# Run from the repo root after `. .\dev-env.ps1`.
$ErrorActionPreference = 'Continue'
cargo build --manifest-path src-tauri/Cargo.toml --example torture_writer 2>$null
$exe = 'src-tauri\target\debug\examples\torture_writer.exe'
$dir = Join-Path $PWD '.tmp\torture'
if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
New-Item -ItemType Directory $dir | Out-Null
$fail = 0
for ($i = 1; $i -le 10; $i++) {
  $p = Start-Process $exe -ArgumentList "`"$dir`"", 'write' -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds (Get-Random -Minimum 150 -Maximum 1000)
  Stop-Process -Id $p.Id -Force
  $p.WaitForExit()
  $out = & $exe $dir check 2>&1
  if ($LASTEXITCODE -ne 0) { $fail++; "run ${i}: FAIL $out" } else { "run ${i}: $out" }
}
"backups kept: $((Get-ChildItem "$dir\backups").Count)"
if ($fail) { "FAILED runs: $fail"; exit 1 } else { 'ALL 10 RUNS LOADED' }
