# Keeping the guide data right

Rules first (MASTER_PLAN §6): every record has a source and a confidence; nothing is filled in from memory or old
(pre-Big-Bang / private-server) guides; MeowDB is link-only; drop rates are only ever official, self-logged or "unknown".

## Where things live

| What | Source files (hand-edited JSON) |
|---|---|
| Version, level cap, job advancements, regions, review point | `datapack/meta.json` |
| Jobs, bosses, party quest, crafting, citizenship | `datapack/jobs.json`, `datapack/unlockables.json` |
| Events (exact UTC windows + article hash) | `datapack/events.json` |
| Monsters, maps (spawns, links, pictures), drops, NPCs, quests, training spots | `datapack/regions/<region>/*.json` |
| Items | `datapack/items/*.json` |
| Stat-point builds | `datapack/ap-builds.json` |
| Gear progression (optional — otherwise derived from drops) | `datapack/gear-progression.json` |
| Videos | `datapack/videos.json` |
| News relevance rules (content-hash pinned) | `datapack/news-rules.json` |
| Not-yet-available content (e.g. Forgotten Hollow) | `datapack/_parked/` (not built) |

## When Nexon posts a patch (Appendix C)

1. The app shows a banner ("Nexon posted … the guide data hasn't been checked against it yet"); the `news-watch`
   workflow also opens an issue.
2. Read the article; list every changed fact (levels, new areas or classes, events, EXP/drop changes).
3. Edit the affected files; cite the article as an `official` source (`articleId`, `url`, `retrievedAt`) and set
   `verifiedAt`.
4. Add or retire `events.json` entries with exact UTC windows and the article's content hash.
5. Bump `meta.reviewedThroughArticleId` and `meta.packVersion` (`YYYY.MM.DD-n`).
6. `npm run datapack:validate` → `npm run datapack:coverage`.
7. Commit and push to `main`. The `datapack-publish` workflow validates, builds, signs and publishes; apps pick it up
   within about 30–40 minutes (Pages caches ~10 min).
8. If a fact can't be confirmed, lower its `confidence` rather than guess.

## Turning Quick notes into data (§6.5)

Notes land in `<data folder>\field-notes\inbox\<timestamp>\` (`note.json` + pictures). For each note: create or update
records with `source.kind: "in-game"`, label `"the owner field note <date>"`, confidence `verified` when a screenshot shows
the value (otherwise `likely`); a MeowDB link in the note gives the exact `ext.meowdb` id. Never complete a partial
note from memory. Move processed notes to `field-notes\processed\<date>\`, validate, and report what was added and
what was unclear.

## Checking the wiki for changes

`npm run datapack:refresh` re-checks only the wiki pages the data cites (one every 3 s) and lists the changed ones in
`.tmp/wiki-refresh-report.txt`. Review those pages and update the matching records. Unattended daily syncing waits for
the wiki maintainers' OK (`docs/wiki-permission-request.md`).

## Refreshing on request (I-28)

The app has no AI key and no schedule for this. When the owner wants fresh data, they open a Claude Code session in
the project folder and say:

> Check the wiki and Nexon for updates.

The session then:

1. Runs `npm run datapack:refresh` and reads `.tmp/wiki-refresh-report.txt`.
2. Reads the newest Nexon news (the app's News screen lists anything not yet reviewed after
   `reviewedThroughArticleId`) and applies Appendix C for patch notes, events and maintenance.
3. Updates the changed records with fresh `retrievedAt`/`verifiedAt` and sources, and bumps `meta.packVersion`.
4. Runs `npm run datapack:validate` and `npm run datapack:coverage`, then commits and pushes. GitHub Actions
   signs and publishes the data. Installed apps pick it up within 30 minutes, or straight away with **Check now** in
   Settings.
5. Reports what changed and what it couldn't confirm.

Same rules as always: one wiki page at a time with citation, MeowDB is link-only, nothing from memory.

## When Forgotten Hollow (or other parked content) opens

Move the records from `datapack/_parked/<area>/` back into `regions/…`, restore their portal links and training spots
(see `_parked/README.md`), validate and publish.
