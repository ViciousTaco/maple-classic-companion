# Releasing a new app version

Releases are built on this PC (the signing key lives in `.keys\`, never in the repo) and served from GitHub.

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (same number, e.g. `1.0.1`).
2. `. .\dev-env.ps1` then run every check: `npm test`, `npm run typecheck`, `npm run lint`,
   `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run datapack:validate`.
3. `npm run exe` — builds `src-tauri\target\release\MapleClassicCompanion.exe` and copies it to the project root.
4. `npm run release -- "What changed, in one sentence"` — writes and signs `releases/latest.json` (version, notes,
   download URL, sha256, exe signature).
5. Check it: `src-tauri\target\debug\examples\verify_update_sig.exe releases\latest.json` should say OK.
6. Commit, tag and push: `git add -A`, `git commit -m "release v1.0.1"`, `git tag v1.0.1`, `git push --follow-tags`.
7. Create the GitHub release for the tag and attach `MapleClassicCompanion.exe` — either
   `gh release create v1.0.1 src-tauri\target\release\MapleClassicCompanion.exe --notes "…"` (after
   `winget install GitHub.cli` and `gh auth login`), or drag the exe onto https://github.com/ViciousTaco/maple-classic-companion/releases/new.
8. The push also triggers `datapack-publish`, which serves the new `releases/latest.json`. Running copies of the app
   show "Version X is ready" within ~30–40 minutes; clicking it downloads the exe, checks its hash and signature,
   swaps itself and restarts.

## One-time GitHub setup (P8-T1)

1. Repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Repo → Settings → Secrets and variables → Actions → New repository secret:
   name `MCC_SIGNING_KEY`, value = the full contents of `.keys\mcc-signing.key` (no password was set, so no
   `MCC_SIGNING_KEY_PASSWORD` is needed).
3. Before every push, `git status` must not list `MapleClassicCompanion-data/`, `field-notes/`, `.keys/`, `.cache/`,
   `.tmp/`, `test-run/` or the exe — they're git-ignored; keep it that way (the repo is public).
