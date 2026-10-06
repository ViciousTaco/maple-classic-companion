# Maple Classic Companion

A free, non-commercial Windows companion for **MapleStory Classic World**. Tell it about your character and it shows
where to train right now (with backups when a map is taken), what's worth looting, where your next gear and stat points
should go, which quests to do and how to get there, live Nexon news and events in Sydney time, and interactive
projections of how long levelling, meso goals and drops will take.

Not affiliated with or endorsed by Nexon. MapleStory and all related names, images and assets belong to Nexon. The app
never changes or interacts with the game — no memory reading, no input, no hooks, no changes to game files. The optional
screen watcher only reads what is already on your screen while you switch it on (off at every launch), the same way
Discord or Teams screen sharing does, using Windows' offline text recognition; pictures are never saved or sent. It
can follow you from map to map, and read your open Character Stats and Skills windows so the character stays current.

## Run it

1. Put `MapleClassicCompanion.exe` in any folder you like (it's portable — no installer).
2. Double-click it. A folder called `MapleClassicCompanion-data` appears next to it — **that's all your data**.
3. Windows may show "Windows protected your PC" the first time (the app isn't code-signed): click **More info → Run anyway**.
4. Needs Microsoft Edge WebView2, which Windows 10/11 normally have. If it's missing, the app says so and links to it.

## Your data

- Characters, settings and backups: `MapleClassicCompanion-data\profiles.json` and `backups\` (newest 20 kept).
- Pictures you add, Quick notes (`field-notes\inbox\`), exports (`exports\`), cached news and pictures (`cache\`).
- To move or back up everything, copy the exe **and** the data folder together. Settings → "Your data" opens these folders.

## Staying up to date

On launch and every 30 minutes while open, the app checks Nexon's news, the guide-data feed
(`https://vicioustaco.github.io/maple-classic-companion/`) and for a newer app version — no restart needed. Guide data
is signed; anything that fails the signature or the checks is ignored and the last good data stays in use.

## Where the guide data comes from

Every fact shows a confidence chip (Verified / Likely / Unconfirmed) — click it to see the source. Sources:
Nexon's official news (verified), your own Quick notes (seen in game), and MapleClassic Wiki (CC BY-NC-SA 4.0, marked
"likely" until confirmed in game). Drop rates are never invented: Nexon hasn't published them. Details: `docs/SOURCES.md`.

## For developers

```powershell
. .\dev-env.ps1          # keeps every cache and temp file inside this folder
npm install
npm run dev              # browser preview with an in-memory mock of the desktop side
npm run tauri dev        # the real desktop app
npm test; npm run typecheck; npm run lint; cargo test --manifest-path src-tauri/Cargo.toml
npm run datapack:validate; npm run datapack:coverage
npm run exe              # builds and copies MapleClassicCompanion.exe to this folder
```

Plan, decisions and progress: `MASTER_PLAN.md`. Data upkeep: `docs/DATA_MAINTENANCE.md`. Releases: `docs/RELEASE.md`.

## Licence

The app code is MIT (see `LICENSE`). The guide data in `datapack/` is CC BY-NC-SA 4.0, derived from MapleClassic Wiki — see `datapack/NOTICE.md`. MapleStory and all game content belong to NEXON.
