# P2-T9 Persistence checks

## Automated (run by the agent)

`. .\dev-env.ps1; .\tests\manual\persistence-torture.ps1` — starts a process that saves ~200 KB continuously through the
real `storage.rs` code, force-kills it at a random moment (150–1000 ms), then loads the file. Repeats 10 times.
Pass = "ALL 10 RUNS LOADED".

## Hands-on (the owner, in `test-run\MapleClassicCompanion.exe`)

1. Create a character, change a few things (level, stats, a screenshot). Wait 1 second, then close the app with the ✕. Reopen → everything is there.
2. Change the level, then within a second end the app in Task Manager (End task). Reopen → everything except possibly that last
   change is there (changes are saved 0.4 s after you stop typing).
3. Copy the whole `test-run` folder (exe + `MapleClassicCompanion-data`) to a new folder inside the project, run the exe there → same characters.
4. Move or resize the window, close, reopen → it comes back in the same place and size.
5. Run the exe a second time while it's open → the existing window comes to the front instead of a second copy.

## Not run

- Read-only exe folder → `%LOCALAPPDATA%` fallback: skipped because the owner asked that nothing is written outside the project
  folder. Covered by the Rust unit test `paths_fallback_when_exe_dir_unwritable`.
