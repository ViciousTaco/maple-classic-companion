# Maple Classic Companion — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single portable Windows `.exe` that tells a MapleStory Classic World player — for their saved character, level, job, stats and chosen focus — where to train right now (plus a backup spot), what to loot, which quests to do and how to get there, with live Nexon news/events shown in Sydney time.

**Architecture:** Tauri 2 desktop shell (Rust) hosting a React + TypeScript UI. All game knowledge lives in a versioned, signed, schema-validated **datapack** (JSON) that is bundled in the exe and refreshed from a static feed on every launch; a pure-TypeScript **recommendation engine** turns `profile + datapack` into a primary pick and backups. Player data is plain JSON saved atomically in a folder beside the exe.

**Tech Stack:** Tauri 2 (Rust, MSVC, WebView2) · React + TypeScript + Vite · Tailwind CSS · Radix UI primitives · `motion` (Framer Motion) · Zustand · zod · Vitest + React Testing Library + Playwright · GitHub Pages/Releases + GitHub Actions for the live data feed.

If you are a model without those sub-skills, ignore that line and follow §0 below — it is self-sufficient.

**Name:** "Maple Classic Companion" → `MapleClassicCompanion.exe` (approved).
**Owner / approver / only user:** the owner (GitHub: ViciousTaco). **Plan created:** 2026-10-05 (Sydney). **Plan version:** 1.1 (reviewed and corrected 2026-10-05; see §15)

---

## 0. READ THIS FIRST — handoff protocol for any AI model

You are picking up a project mid-flight. Follow these rules exactly.

1. **Orient:** read §1 (Status Board), §2 (Approval Gates), then the last 3 rows of §14 (Session Log). That tells you where things are.
2. **Pick work:** take the first unchecked task (`- [ ]`) in the lowest-numbered phase whose gate (if any) is `APPROVED`. Do tasks in ID order unless a task says "parallel-safe".
3. **Never cross a gate.** If the next task depends on a gate marked `PENDING OWNER`, stop and ask the owner that exact question. Work on gate-free tasks meanwhile.
4. **Before coding a phase:** expand that phase's tasks into step-level TDD steps (write failing test → run → implement → run → commit). The contracts in §8 are binding: names, types and formulas there must not drift.
5. **Done means verified.** Tick a checkbox only after running the task's **Verify** command and seeing the stated result. Paste a one-line result into the Session Log. If it fails, leave it unticked and record why.
6. **Update this file at the end of every session:** tick boxes, update §1 Status Board, append a §14 Session Log row (date in Sydney time, model, what changed, exact next step). Commit the file with the code.
7. **Ideas need the owner's approval.** You may add rows to §13 with status `PROPOSED`. Only the owner can change a row to `APPROVED`. Never build a `PROPOSED` idea, and never widen scope silently.
8. **Locked decisions (§3) are locked.** To change one, ask the owner, then record it in §15 Plan Change Log.
9. **Accuracy rules (§6) are hard rules**, not style preferences. In particular: no pre-Big-Bang / private-server / MapleSEA legacy numbers presented as Classic World facts, and **no scraping, crawling or bulk-copying of MeowDB by any tool or AI agent** (G-1 = link out only).
10. **Never touch the game client.** No memory reading, packet inspection, input automation, overlays that hook the game, or extracting client files. This app is a separate window of information only. (Nexon sanctions unauthorised programs across both MapleStory and Classic World.)
11. **Path hazard (CONFIRMED by test, 2026-10-05):** a folder name containing `&` breaks every npm bin shim (`vite`, `tauri`, `vitest`, `npx …` fail with `'Leveling' is not recognized…`). **Never run npm/cargo/tauri commands from a path containing `&`.** Do P0-T3 before anything else and use the resulting clean path for every command in this plan. Paths with spaces are fine when quoted.
12. **Shell notes for this PC:** Windows 10 Home; PowerShell 5.1 (no `&&`; use `;`). `cmd` is not on PATH inside some agent shells — use PowerShell or Git Bash. Node lives at `%LOCALAPPDATA%\hermes\node\`.
13. **Everything stays inside the project folder (the owner, 2026-10-05).** Before any npm/cargo/tauri/playwright command, dot-source `.\dev-env.ps1` (puts Node on PATH and redirects `CARGO_HOME`, npm cache, Playwright browsers and `TEMP`/`TMP` into `.cache\` and `.tmp\`). Test exes run from `test-run\` (not the Desktop). Keys live in `.keys\`. Agents must not write scratch files elsewhere (use `.tmp\`). All of these folders are git-ignored. Only the installed toolchains themselves (Node, Rust, VS, WebView2) live outside.

---

## 1. Status Board

| Phase | Name | Status | Gate needed | Suggested effort |
|---|---|---|---|---|
| P0 | Decisions & groundwork | DONE (2026-10-05) | — | medium |
| P1 | Skeleton + risk spikes | DONE (2026-10-05) — Tauri kept (D-1), no fallback needed | none | high |
| P2 | Characters & persistence | DONE (2026-10-05; hands-on checklist in `tests/manual/persistence.md` for the owner) | none (G-6 approved) | high |
| P3 | Datapack v0 (game data) | DONE for v1.0 (Lv 1–55; coverage target met); videos (T9) and more quests ongoing | P3-T0 source list approval; the owner's field notes | **xhigh** |
| P4 | Recommendation engine | DONE (2026-10-06) | — | **xhigh** |
| P5 | Core UI | DONE (2026-10-06) — iOS "Maple Glass" design | — | high |
| P6 | Quests & navigation | DONE (2026-10-06) | — | high |
| P7 | News & events (Sydney time) | DONE (2026-10-06) — live in the exe | — | high |
| P8 | Live updates (data + app) | DONE except owner's 2 GitHub clicks (Pages source, signing secret) | owner clicks | **xhigh** |
| P9 | Media & polish | DONE (2026-10-06) | — | medium–high |
| P10 | Packaging, QA, release | v1.0.0 built + signed; GitHub Release upload and clean-PC check by owner | owner | high |
| P11 | Approved ideas only | NOT STARTED | per idea (§13) | varies |

**Current position:** P0 done; P1-T1 scaffold done (Tauri 2 + React + TS at repo root, window opens). **Next action:** the owner tries Phase 2 in `test-run\` (checklist `tests/manual/persistence.md`) → P3-T0 source survey (needs the owner's approval of the list) and P3-T1…T4, T10 → P4. The public GitHub repo `maple-classic-companion` already exists (empty); ask the owner for the GitHub username when reaching P8-T1 if it is not yet recorded in §2 G-2.

### 1.1 Build order and dependencies

Phases are numbered for reference; build in this order so something usable exists early:

```
P0 → P1 → P2 ─┐
P3-T0…T4, T10 ─┼→ P4 → P5 → ★ Milestone A
               │
P7 (needs only P1) can run any time after P1, in parallel
P3-T5…T9, T11 (content) runs continuously from Milestone A onward as sources/field notes arrive
P6 (needs P4-T7/T8, P5-T1/T2) → ★ Milestone B
P8 (needs P3-T3, P1-T8) → P9 → P10 → ★ Milestone C (v1.0.0)
```

| Milestone | Means | The owner can do |
|---|---|---|
| A — "It guides me" | Portable exe with characters, bundled data, Train/Loot/Gear/Home working | Use it while playing; start feeding field notes |
| B — "It navigates" | Quests, routes, live news/events in Sydney time | Follow quests and events from the app |
| C — "It keeps itself current" | Data and app update on launch; images; polished; released | Stop rebuilding by hand |

Task IDs inside a phase are done in order. A phase is DONE only when every task is ticked and every command in §11 passes.

---

## 2. Approval Gates (decisions only the owner can make)

Record answers here. Format: `APPROVED: <choice> — <date>`.

| ID | Question | Recommended default | Blocks | Status |
|---|---|---|---|---|
| G-1 | **MeowDB data use.** Their Terms (updated 28 Sep 2026) prohibit "automated scripts, bots, or scrapers … without permission" and allow only "short excerpts with attribution and a link". Options: (a) the owner emails them for permission (draft in Appendix A) and we deep-link only until they answer; (b) deep-link only, never ask; (c) other source. | (a) | P3-T5…T9 data volume | APPROVED: (b) link out only, no email — 2026-10-05. Links must be exact (built from a recorded `ext.meowdb` id; if no id is recorded, do not guess — show no link). Other sources may be used after a licence check (§6.1). |
| G-2 | **Live-update hosting.** Auto-updating game data needs somewhere to publish it. Recommended: a free public GitHub repo (Pages for data, Releases for the exe). Needs the owner to have/create a GitHub account. Alternative: no hosting → news stays live, but guide data only changes when a new exe is built. | GitHub | P8 | APPROVED: GitHub, **public** repo `maple-classic-companion`, created empty by the owner — 2026-10-05. GitHub username: **ViciousTaco** (recorded 2026-10-05). Remote: `https://github.com/ViciousTaco/maple-classic-companion.git`. Feed base URL: `https://vicioustaco.github.io/maple-classic-companion/` (Pages hosts are lower-case). **Push approved by the owner 2026-10-05** ("push when P8 is ready", after the private-files check). |
| G-3 | **Audience.** Just the owner, friends/guild, or public download? Affects code-signing, IP caution, support load. | The owner + friends | P8-T6, P10 | APPROVED: The owner only — 2026-10-05 |
| G-4 | **Game images (monster/item/map art are Nexon's).** (a) hotlink official Nexon news images + the owner's own screenshots + original icons, link out to MeowDB for sprites; (b) also use a public sprite API if spike P9-T1 proves one works for Classic names and its terms allow; (c) bundle ripped sprites (not recommended). | (a), then (b) if it checks out | P3, P9 | APPROVED (personal use) — 2026-10-05: (a) + (b), plus two additions: every monster/map/item/NPC card accepts a pasted or dropped image saved locally in the data folder (same flow as §9.3), and has a "Find image" button that opens a web image search for that name in the default browser. No automatic downloading from image search results (wrong-image risk, no stable URLs). |
| G-5 | **Name and look.** Approve the working title and one static mock screen before all screens are built. | "Maple Classic Companion", warm nostalgic theme | P5 | Name APPROVED — 2026-10-05. Style changed by the owner to an iOS 26/27 glass feel (§9.5). Mock: Train screen with made-up sample data (`src/features/train/TrainPreview.tsx`). **APPROVED ("approved, tweak later") — 2026-10-05.** |
| G-6 | **Meaning of "the character the user has unlocked so far".** Plan assumes: what *this character* has unlocked — job advancements, areas reached, quests done, bosses beaten, party quest, citizenship, crafting. Confirm or correct. | as assumed | P2-T5 | APPROVED: as assumed — 2026-10-05 |
| G-7 | **Code signing** (only if G-3 = public). Unsigned exes show a Windows SmartScreen warning on other PCs. Certificates cost money yearly. | Unsigned for personal/friends | P10 | APPROVED: unsigned — 2026-10-05 |

---

## 3. Locked decisions (do not change without the owner)

| # | Decision | Why |
|---|---|---|
| D-1 | **Tauri 2**, not Electron. | This PC already has Rust 1.95 (msvc), VS 2022 C++ tools, WebView2 154 and Node 22. Gives one ~10–20 MB exe instead of ~100 MB+. Fallback rule: if spikes P1-T5/T6/T7 fail and can't be fixed in one session, switch to Electron `portable` target and log it in §15. |
| D-2 | **Portable = one exe + a data folder beside it** (`MapleClassicCompanion-data\`). If that location is read-only, fall back to `%LOCALAPPDATA%\MapleClassicCompanion` and tell the user where data lives. | "Portable" and "never lose my character" both hold when the folder travels with the exe. |
| D-3 | **Player data is JSON files written atomically by Rust** (temp file → fsync → rename) with rolling backups. Not `localStorage`. | Survives crashes, cache clears and moving PCs; human-readable. |
| D-4 | **Game knowledge is data, not code.** Everything the guide says comes from the datapack; scoring weights and formulas too. | Lets data update on launch without a new exe. |
| D-5 | **Two update channels:** datapack (every launch, background, hot-swap) and app exe (rare, signed, user-confirmed). | "Always up to date" is 95% a data problem. |
| D-6 | **News/events come straight from Nexon's public CMS JSON** (`g.nexonstatic.com/maplestory/cms/v1`), reusing the validated logic from the owner's Astra tracker. | Official, already proven, no key or login. |
| D-7 | **Times display in `Australia/Sydney`** (AEST/AEDT chosen per instant via the tz database), with a setting to use the PC's zone instead. | The owner's requirement; Astra's tested approach. |
| D-8 | **Every displayed game fact carries provenance** (source, date, confidence). Unknown is shown as unknown. | The only honest route to "accurate". |
| D-9 | **Progressive disclosure:** each screen shows ≤ 3 primary cards; detail lives in collapsed accordions; a minimal profile (name, job, level) is enough to get recommendations. | "Don't overwhelm the user." |
| D-10 | **The app never interacts with the game process.** Amended 2026-10-06 (owner): the opt-in **screen watcher** may read *pixels* of a screen region the owner selects, only while the owner has switched it on (off at every launch; visible indicator; one-click/hotkey off). Never memory reading, packet inspection, input automation, hooking, injection or client-file extraction. Frames are processed in memory with Windows' offline OCR and discarded; only parsed numbers are stored locally; nothing is sent anywhere. | Account safety; owner accepted the residual ToS ambiguity of passive screen reading. |
| D-11 | **The character always shows what the screen shows.** The watcher applies the level it reads (schema 1–300) even above the guide's `levelCap`; the cap only limits advice (spots, quests, AP builds end there) and the UI says so. Never silently refuse a reading because the guide has no data for it. | Owner (2026-10-06): otherwise the app is less trustworthy as a reader of the screen. |
| D-11 | **Non-commercial fan tool** with a visible disclaimer: not affiliated with Nexon; MapleStory assets belong to Nexon. | IP hygiene. |

---

## 4. Requirements traceability (the owner's brief → where it is built)

| Requirement | Built in |
|---|---|
| Portable `.exe` | P1-T3, P1-T7, P10 |
| Always up to date; auto-update on open | P7 (news live), P8 (datapack + app), P7-T7 (staleness banner) |
| Top places to train | P3-T8, P4-T1…T4, P5-T4 |
| Best items + drop rates | P3-T6, P4-T5, P5-T5 (see §6.3 on what "drop rate" can honestly show) |
| Quest navigation | P3-T7, P4-T7/T8, P6 |
| Easy to navigate; know where you're up to | D-9, P5-T2/T3/T7, P6-T1 |
| Chosen level/class etc. never lost | D-2, D-3, P1-T4, P2-T2, P2-T9 |
| Images, icons, YouTube videos | P1-T6, P3-T9, P9 |
| Collapsed by default, expand on demand | D-9, P5-T1 (Accordion), every screen spec in §9 |
| 100% accurate, auto-updating info | §6 (policy), P3-T2 (validator), P8-T5 (CI), honest limits in §6.4 |
| Character name, screenshot (paste), class, level, stats, skills, unlocks | P2-T3…T7 |
| Recommendations use all those factors | P4 (engine inputs §8.4) |
| Backup training spot when a map is taken | P4-T4 (`pickPlan`, skip list), P5-T4 ("Map taken?" button) |
| Multiple saved character slots | P2-T3 |
| Paths: EXP / Rare drop / Class equip / Meso / Balanced | §8.4 weights, P5-T4 focus switcher |
| Sources: MeowDB, Nexon official | §6.1, G-1 |
| Reuse Astra's events/updates tracker, Sydney time | Appendix B, P7 |
| Super interactive, animations | P5-T8, §9.4 |
| Further recommendations, approved by the owner | §13 |
| Detailed plan another AI can follow, with progress | this file, §0, §1, §14 |

---

## 5. Verified facts (as of 5 Oct 2026) — seed data may rely on these

Source for all rows unless noted: Nexon, "Founder's Access Release Notes", article 45621, https://www.nexon.com/maplestory/news/general/45621 (published 3 Oct 2026) and "MapleStory Classic World FAQ", article 45385.

| Fact | Value |
|---|---|
| Founder's Access start | 6 Oct 2026 18:00 UTC = **Wed 7 Oct 2026, 5:00 am AEDT** (Nexon's FAQ prints "4:00 AM AEST October 7"; Sydney is on AEDT from 4 Oct 2026, so the wall clock is 5:00 am) |
| Grand Launch | 21 Oct 2026 11:00 AM PDT = 18:00 UTC = **Thu 22 Oct 2026, 5:00 am AEDT** |
| Max level | 100 |
| Characters per account | 3 |
| Start | Beginner on Maple Island → Victoria Island |
| 1st job | Lv 10 for all four: Warrior (Dances with Balrog, Perion), Magician (Grendel the Really Old, Ellinia), Bowman (Athena Pierce, Henesys), Thief (Dark Lord, Kerning City) |
| 2nd job | Lv 30: Fighter / Page / Spearman · Wizard (Fire/Poison) / Wizard (Ice/Lightning) / Cleric · Hunter / Crossbowman · Assassin / Bandit |
| Bosses available | Mano, Mushmom, Shade, Zombie Mushmom, Jr. Balrog |
| Not available yet | Forgotten Hollow ("planned for a later date") |
| Party quest | "First Time Together" (Kerning City), Lv 21+, ends with King Slime |
| Crafting (Lv 10+) | Smithing (Silas Irons), Weaponcrafting (Mr. Thunder), Tailoring (Francois), Woodcrafting (Vicious), Leatherworking (JM From tha Streetz), Arcforge (Chrishrama) |
| Citizenship (Lv 12+) | Henesys (Arthur, Town Hall) or Kerning City (Roxy, Civic Center); Community Board requests raise grade |
| Event: Founder's First Step | 6 Oct 18:00 UTC – 20 Oct 23:59 UTC (= Wed 21 Oct 10:59 am AEDT); Lv 10+; talk to Maple Administrator; cumulative daily check-ins |
| GM events | 12:00–2:00 AM UTC on 7, 9, 12, 14, 19 Oct; 1:00–2:00 AM UTC on 11, 16, 20 Oct; via Paul at Lith Harbor |
| Founder's Package claim deadline | 30 Nov 2026 23:59 UTC = Tue 1 Dec 10:59 am AEDT |
| Founder's Package sale ends | 14 Oct 2026 11:59 PM PDT = Thu 15 Oct 5:59 pm AEDT |
| Platforms / input | Windows + macOS; English, Spanish (beta); Xbox/DualSense/DualShock controllers |

**Known unknowns — do NOT assume; verify before adding to the datapack:**

- 3rd/4th job availability (official notes list only 1st and 2nd).
- Whether Ossyria is reachable at Founder's Access (an "Ossyria Exploration Report" post exists, image-only).
- EXP table, level-difference EXP penalty, accuracy and damage formulas.
- **Any drop-rate percentage.** Nexon has published none. MeowDB currently lists drops as "community sourced — items players have personally seen drop" with up/down votes and no percentages; its other list is labelled "historical reference only" from pre-Big-Bang MapleSEA.
- Classic World is **retuned**; old numbers are wrong. Example (MeowDB, 5 Oct 2026): Blue Mushroom is Lv 19 / 342 HP / 35 EXP; Mushmom is Lv 40 / 34,440 HP. Legacy guides say otherwise.
- Data on fan sites today reflects Closed Online Test 2 (Aug 2026) and may change at launch.

---

## 6. Data & accuracy policy (hard rules)

### 6.1 Source tiers

| Tier | Source | How we may use it |
|---|---|---|
| A — Official | Nexon news/patch notes via the public CMS JSON | Fetch automatically, politely (ETag, ≥180 ms pacing, 3 retries, 30 s timeout — as Astra does). Quote facts with article link. |
| B — In-game | What the owner (or a contributor) sees in the live game, ideally with a screenshot | Enter by hand with `source.kind = "in-game"`. Highest trust for mob level/EXP, map names, NPC locations, quest text. |
| C1 — NiaMeowDB | meowdb.com/msclassic | **Link out only** (G-1). The app opens their page in the owner's browser — ordinary site use, no account risk. No tool or AI agent may crawl, scrape, bulk-copy or download sprites. Allowed: the owner reading the site themselves and noting facts in field notes (§6.5); an agent opening **one** page to confirm **one** specific fact the owner asked about, cited as a `community` source. |
| C2 — Other community | Wikis, guides, videos about **Classic World** | Only sources listed as approved in `docs/SOURCES.md` (task P3-T0). Check licence/terms first: CC BY-SA or similar wikis are usable with attribution; sites that forbid automated access get the C1 treatment. |
| X — Legacy | Pre-Big-Bang GMS/MapleSEA, private servers, old guides | Never shown as Classic World fact. May only appear as `status: "legacy-unverified"` hints, visibly labelled. |

MeowDB deep-link patterns (for `ext.meowdb`): `/msclassic/monsters/{id}`, `/msclassic/maps/{9-digit code}`, `/msclassic/item-db/{id}`, `/msclassic/quest-tracker/{id}`. **Link accuracy rule:** `ext.meowdb` is filled only with an id someone has seen in the address bar of the correct MeowDB page. If it is empty the UI shows no MeowDB link for that record (never a guessed id, never a name search).

### 6.2 Provenance on every record

Each datapack record has `sources[]` (≥ 1) and `confidence`: `verified` (Tier A, or Tier B with evidence), `likely` (one credible Tier C source), `unverified` (reported, unconfirmed). The UI shows a small chip; tapping it reveals source and date.

### 6.3 Drop rates — what the app shows

- `exact` — a percentage, **only** if Nexon publishes one.
- `sampled` — "seen 3 times in 1,240 kills", from logged kills (idea I-01), shown with sample size, never as a bare percentage.
- `tier` — common / uncommon / rare / very rare, community judgement, shown as a word.
- `unknown` — shown as "Confirmed drop · rate not known yet".

The engine may use internal *heuristic weights* for tiers to rank spots; those weights are never displayed as rates.

### 6.4 What "100% accurate" means here

Nobody can guarantee that every fan-sourced number is right, and Nexon publishes no drop tables. The enforceable target is: **zero facts shown without a source and confidence label; zero legacy numbers passed off as current; official facts refreshed live; a visible banner whenever Nexon has posted a patch newer than the data has been reviewed against.** The validator (P3-T2) and CI (P8-T5) enforce this.

### 6.5 Field notes — how Tier B data gets in

Because G-1 is link-only, the owner's own play is the main source for monsters, maps, spawns, drops and quests.

- The owner drops screenshots or short notes into `field-notes\inbox\` in the repo folder (any format: "Lv 19 Blue Mushroom, 35 exp, The Blue Mushroom Forest, dropped Blue Mushroom Cap"), or pastes them into chat.
- The maintaining model converts each note into datapack records with `source.kind: "in-game"`, `label: "the owner field note <date>"`, `confidence: "verified"` when a screenshot shows the value, otherwise `"likely"`; moves the note to `field-notes\processed\<date>\`; runs the validator; reports what was added and what was unclear.
- `field-notes\` is git-ignored (screenshots may show account details).
- Never "complete" a partial note from memory or legacy knowledge. Missing fields stay missing (schemas mark them optional).

---

## 7. Architecture

```
┌──────────────────────────── MapleClassicCompanion.exe ────────────────────────────┐
│ Rust (Tauri 2)                                                                    │
│  paths.rs      portable data dir resolution                                       │
│  storage.rs    atomic JSON save/load, backups, corruption recovery                │
│  screenshots.rs  save/read/delete character images                                │
│  datapack.rs   staged install, sha256 + signature verify, swap, rollback          │
│  updater.rs    app self-update (verify → self-replace → relaunch)                 │
│  plugins: http (allow-listed hosts), opener, single-instance                      │
│                                                                                   │
│ WebView (React + TS)                                                              │
│  platform/   typed IPC wrappers  (+ in-memory mock for tests/browser)             │
│  data/       zod schemas, datapack loader, indexes, update client                 │
│  engine/     pure functions: estimate, score, recommend, route, quests            │
│  features/   characters · home · train · loot · gear · quests · news              │
│  ui/         design system (Accordion, Card, Chip, Stepper, Toast…)               │
│  lib/        sydney time, formatting                                              │
└───────────────────────────────────────────────────────────────────────────────────┘
        │ launch: read                      │ background: fetch
        ▼                                   ▼
MapleClassicCompanion-data\          Static feed (GitHub Pages)      Nexon CMS JSON
  profiles.json                        datapack/manifest.json(+.sig)   /news, /news/{id}
  backups\                             datapack/*.json
  screenshots\<profileId>.webp         releases/latest.json(+.sig)
  images\<kind>\<id>.webp  (the owner's own pasted pictures for monsters/maps/items/NPCs)
  packs\<version>\  current.txt
  cache\news\  webview\  logs\
```

Feed URLs (public repo, GitHub Pages): `https://vicioustaco.github.io/maple-classic-companion/datapack/manifest.json`, `…/datapack/manifest.json.sig`, `…/datapack/<file>.json`, `…/releases/latest.json`, `…/releases/latest.json.sig`. Pages caches for about 10 minutes, so a published update can take that long to appear. The exe itself is a GitHub Release asset: `https://github.com/ViciousTaco/maple-classic-companion/releases/download/v<version>/MapleClassicCompanion.exe` (redirects to a `*.githubusercontent.com` host).

Rust crates beyond the scaffold: `serde`, `serde_json`, `chrono`, `sha2`, `base64`, `minisign-verify`, `self-replace`, `reqwest` (via `tauri-plugin-http`), `tempfile` (dev). Tauri plugins: `http`, `opener`, `single-instance`. (No `window-state`: it writes to `%APPDATA%` and breaks portability — window geometry is stored in `profiles.json` `settings.window` instead; see §15.)

### 7.1 Repository layout

```
MASTER_PLAN.md
package.json  vite.config.ts  tsconfig.json  index.html  tailwind config
src/
  main.tsx  App.tsx
  app/        shell, routes, providers
  features/   characters/ home/ train/ loot/ gear/ quests/ news/
  engine/     weights.ts estimate.ts subscores.ts recommend.ts reasons.ts route.ts quests.ts loot.ts gear.ts
  data/       schema/ (zod)  pack.ts (loader+indexes)  updateClient.ts
  platform/   ipc.ts  ipc.mock.ts
  lib/        sydney.ts  format.ts
  ui/         components
src-tauri/
  src/ main.rs lib.rs paths.rs storage.rs screenshots.rs datapack.rs updater.rs
  tauri.conf.json  capabilities/default.json  Cargo.toml  .cargo/config.toml  icons/
datapack/     SOURCE of game data (hand-edited JSON)
  meta.json formulas.json focus-profiles.json jobs.json events.json news-rules.json videos.json gear-progression.json
  skills/<job>.json   items/<category>.json
  regions/<region>/maps.json monsters.json drops.json npcs.json quests.json training-spots.json
scripts/      datapack-validate.ts datapack-build.ts coverage-report.ts check-videos.ts sign.ts release.ts
tests/e2e/    Playwright specs
docs/         DATA_MAINTENANCE.md SOURCES.md RELEASE.md   (written in P10)
.github/workflows/  ci.yml datapack-publish.yml video-check.yml news-watch.yml
```

### 7.2 Launch sequence (target: usable in < 2 s, never blocked by the network)

1. Rust resolves the data dir; sets `WEBVIEW2_USER_DATA_FOLDER` to `<data>\webview` **before** building the Tauri app.
2. UI loads `profiles.json` and the active datapack (newest of: installed pack, bundled baseline). Screen renders.
3. In the background, in parallel: datapack manifest check, Nexon news refresh, app version check.
4. Results hot-swap in with a toast. A pill in the top bar always shows `Data v2026.10.07-1 · checked 12 s ago` / `Offline · data from 6 Oct`.
5. While open: re-check news + manifest every 30 minutes.

---

## 8. Contracts (binding — do not rename or reshape without logging in §15)

### 8.1 Rust: portable data directory — `src-tauri/src/paths.rs`

```rust
use std::{env, fs, path::{Path, PathBuf}};

pub const DATA_DIR_NAME: &str = "MapleClassicCompanion-data";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths { pub data_dir: PathBuf, pub portable: bool }

fn is_writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() { return false; }
    let probe = dir.join(".write-probe");
    match fs::write(&probe, b"ok") {
        Ok(_) => { let _ = fs::remove_file(&probe); true }
        Err(_) => false,
    }
}

/// Portable first (folder beside the exe); otherwise %LOCALAPPDATA%.
pub fn resolve(exe_dir: &Path, local_app_data: Option<&Path>) -> Result<AppPaths, String> {
    let portable = exe_dir.join(DATA_DIR_NAME);
    if is_writable(&portable) { return Ok(AppPaths { data_dir: portable, portable: true }); }
    let base = local_app_data.ok_or("No writable location found for app data")?;
    let fallback = base.join("MapleClassicCompanion");
    if is_writable(&fallback) { return Ok(AppPaths { data_dir: fallback, portable: false }); }
    Err("No writable location found for app data".into())
}

pub fn resolve_from_env() -> Result<AppPaths, String> {
    if let Some(over) = env::var_os("MCC_DATA_DIR") {            // dev/test override
        let p = PathBuf::from(over);
        return if is_writable(&p) { Ok(AppPaths { data_dir: p, portable: false }) }
               else { Err("MCC_DATA_DIR is not writable".into()) };
    }
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().ok_or("exe has no parent directory")?;
    let lad = env::var_os("LOCALAPPDATA").map(PathBuf::from);
    resolve(exe_dir, lad.as_deref())
}
```

Tests (use the `tempfile` dev-dependency): (1) writable exe dir → `portable == true` and folder exists; (2) exe dir is a path under a *file* (so `create_dir_all` fails) with a writable fallback → `portable == false`, path ends with `MapleClassicCompanion`; (3) both unwritable → `Err`.

### 8.2 Rust: atomic save — `src-tauri/src/storage.rs`

```rust
use std::{fs, io::Write, path::Path};

fn e<T: std::fmt::Display>(x: T) -> String { x.to_string() }

/// Validates JSON, optionally snapshots the previous file, then replaces atomically.
pub fn save_json_atomic(path: &Path, json: &str, backup_to: Option<&Path>) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|x| format!("Refusing to save invalid JSON: {x}"))?;
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(e)?; }
    if let (Some(dir), true) = (backup_to, path.exists()) {
        fs::create_dir_all(dir).map_err(e)?;
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ");
        fs::copy(path, dir.join(format!("profiles-{stamp}.json"))).map_err(e)?;
    }
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(e)?;
        f.write_all(json.as_bytes()).map_err(e)?;
        f.sync_all().map_err(e)?;
    }
    fs::rename(&tmp, path).map_err(e)   // replaces the existing file on Windows
}
```

Rules around it (implement in the same module, test each):

- **Backup cadence:** pass `backup_to` on the first save of an app session and whenever the newest backup is > 60 minutes old. Keep the newest 20 backups; delete older.
- **Load recovery:** if `profiles.json` fails to parse → rename it `profiles.corrupt-<stamp>.json`, load the newest backup that parses, and return a flag so the UI shows "Restored from backup taken <time>". If no backup parses → start empty **and keep the corrupt file**. Never silently discard data.
- **Single writer:** `tauri-plugin-single-instance` focuses the existing window instead of opening a second copy.
- **Flush:** the UI debounces saves 400 ms; on `CloseRequested` the window waits for a final flush.

### 8.3 IPC commands (Rust `#[tauri::command]`, wrapped in `src/platform/ipc.ts`)

| Command | Args → Returns | Notes |
|---|---|---|
| `get_paths` | → `{ dataDir: string, portable: boolean }` | shown in Settings |
| `profiles_load` | → `{ json: string \| null, restoredFromBackup: string \| null }` | |
| `profiles_save` | `{ json: string }` → `void` | uses 8.2 |
| `backups_list` / `backups_restore` | → `{ file, savedAt }[]` / `{ file }` → `string` | |
| `screenshot_save` | raw body = image bytes (`Uint8Array`), header `x-profile-id` → `{ file: string }` | Rust checks: magic bytes are WebP/PNG/JPEG and size ≤ 400 KB, `profileId` is a UUID. The UI does the resize to ≤ 512 px before sending. |
| `screenshot_read` | `{ profileId }` → raw bytes (`ArrayBuffer`, empty = none) | UI makes a blob URL |
| `screenshot_delete` | `{ profileId }` → `void` | |
| `entity_image_save` | raw body = image bytes, headers `x-kind` (`monster\|map\|item\|npc`), `x-id` → `{ file }` | same checks; `id` must match `^[A-Za-z0-9_-]{1,64}$`; stored at `images\<kind>\<id>.webp` |
| `entity_image_read` / `entity_image_delete` | `{ kind, id }` → raw bytes (empty = none) / `void` | The owner's own image always wins over a pack image |
| `pack_active` | → `{ version: string \| null, dir: string \| null }` | `null` → no installed pack; UI uses the bundled baseline |
| `pack_read` | `{ file }` → `string` | from the active installed pack; `file` must match `^[a-z0-9.-]+\.json$` |
| `pack_verify_manifest` | `{ manifestJson, signature }` → `{ ok: boolean }` | minisign check against the compiled-in public key |
| `pack_install` | `{ manifestJson, signature, files: { path, bytes }[] }` → `{ version }` | §8.6 steps 7–9; re-verifies the signature itself |
| `app_update_apply` | `{ url, sha256, signature }` → never returns (relaunch) | P8-T6. Rust downloads the file itself and refuses any `url` not starting with `https://github.com/ViciousTaco/maple-classic-companion/releases/download/` |
| `screen_list_windows` | → `{ id, title, app, width, height, minimized }[]` | I-29. Visible titled top-level windows, ours excluded. Process names via a ToolHelp snapshot (no process handle opened) |
| `screen_snapshot` | `{ windowId }` → `{ pngBase64, width, height, sourceWidth, sourceHeight, covered }` | Setup only; GDI copy of the on-screen pixels, long edge ≤ 1600 px; never written to disk |
| `screen_read` | `{ windowId, regions: { name, x, y, w, h, scale?, filter?, mode? }[] }` → `{ name, lines: { text, x, y, w, h }[], covered, fill? }[]` | Windows.Media.Ocr in memory; `covered` = another window overlapped, ignore the text. Only called while the owner has the watcher on |
| `hotkey_status` / `hotkey_set` | → `{ registered, accelerator }` / `{ accelerator }` → same | Default Ctrl+Shift+K → event `mcc://watch-toggle` (receives only; never sends input). I-33: the UI stores the owner's choice in `settings.hotkey` and re-applies it at startup; Rust rejects a bare key |
| `notify_status` / `notify_show` / `notify_fallback` | → `{ toast, reason }` / `{ title, body }` → `{ via, reason }` | I-26. Portable exe has no AppUserModelID, so Windows 10 drops toasts → taskbar flash + `mcc://notify` banner |
| `watch_log_append` / `watch_log_clear` | `{ line }` → file name / → count | I-44 diagnostic log: one JSON line of recognised *text* + decisions per read → `field-notes\\watch-log\\<date>.jsonl`; only while `settings.watch.diagnostics`; never pixels |
| `mini_window_open` / `mini_window_close` / `relay_to_main` | → `void` / `{ kind, payload }` → `void` | I-24. Label `mini`, same `<data>\webview`. `relay_to_main` emits `mcc://mini-action` to `main` only; `profiles_save` from `mini` is refused; every save emits `mcc://profiles-saved` |

`src/platform/ipc.mock.ts` implements the same interface in memory so the UI runs in a plain browser and in Vitest/Playwright. Select the implementation by `'__TAURI_INTERNALS__' in window`.

Network access uses `tauri-plugin-http` with capability scope limited to: `https://g.nexonstatic.com/maplestory/cms/v1/*` and `https://vicioustaco.github.io/maple-classic-companion/*`. Send `User-Agent: MapleClassicCompanion/<version> (personal news reader)` to Nexon, as Astra does. (YouTube availability checks run in GitHub Actions, not in the app.)

Links opened in the default browser go through `tauri-plugin-opener`, scoped to `https://www.nexon.com/*`, `https://meowdb.com/msclassic/*`, `https://www.youtube.com/*`, `https://youtu.be/*`, `https://www.google.com/search*` (the "Find image" button: `https://www.google.com/search?tbm=isch&q=` + `encodeURIComponent('MapleStory Classic ' + name)`), `https://github.com/ViciousTaco/maple-classic-companion/*`, plus any source host approved in `docs/SOURCES.md`. Everything fetched is treated as untrusted data: parse → zod-validate → render as text. Never `dangerouslySetInnerHTML` remote HTML.

### 8.4 Profile schema — `src/data/schema/profile.ts`

```ts
import { z } from 'zod';

export const JOB_IDS = ['beginner',
  'warrior','fighter','page','spearman',
  'magician','wizard-fp','wizard-il','cleric',
  'bowman','hunter','crossbowman',
  'thief','assassin','bandit'] as const;
export const FOCUS_IDS = ['exp','rare-drop','class-equip','meso','balanced'] as const;
export type JobId = typeof JOB_IDS[number];
export type FocusId = typeof FOCUS_IDS[number];

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const iso = z.string().datetime();

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(24),
  createdAt: iso, updatedAt: iso,
  jobId: z.enum(JOB_IDS),
  level: int(1, 300),                       // UI clamps to pack.meta.levelCap (100 today)
  expPercent: z.number().min(0).max(100).nullable().default(null),
  focus: z.enum(FOCUS_IDS).default('balanced'),
  stats: z.object({ str: int(0, 9999), dex: int(0, 9999), int: int(0, 9999), luk: int(0, 9999),
                    hp: int(0, 99999), mp: int(0, 99999) }).partial().default({}),
  combat: z.object({ damageMin: int(0, 999999), damageMax: int(0, 999999),
                     accuracy: int(0, 9999), avoid: int(0, 9999),
                     weaponType: z.string().max(32), mainSkillId: z.string().max(64) }).partial().default({}),
  skills: z.record(z.string(), int(0, 30)).default({}),
  unlocks: z.object({
    areas: z.array(z.string()).default([]),
    questsDone: z.array(z.string()).default([]),
    questsActive: z.array(z.string()).default([]),
    bossesDefeated: z.array(z.string()).default([]),
    partyQuests: z.array(z.string()).default([]),
    citizenship: z.object({ town: z.enum(['henesys','kerning']), grade: int(0, 99) }).nullable().default(null),
    crafting: z.record(z.string(), int(0, 999)).default({}),
  }).default({}),
  wishlistItemIds: z.array(z.string()).default([]),
  skippedSpots: z.array(z.object({ spotId: z.string(), until: iso })).default([]),
  screenshot: z.object({ file: z.string(), updatedAt: iso }).nullable().default(null),
  lastView: z.string().default('/home'),
  notes: z.string().max(4000).default(''),
  archived: z.boolean().default(false),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfilesFileSchema = z.object({
  schemaVersion: z.literal(1),
  activeProfileId: z.string().uuid().nullable(),
  profiles: z.array(ProfileSchema),
  settings: z.object({
    timeZoneMode: z.enum(['sydney','system']).default('sydney'),
    motion: z.enum(['system','full','reduced']).default('system'),
    theme: z.enum(['system','day','night']).default('system'),
  }).default({}),
});
export type ProfilesFile = z.infer<typeof ProfilesFileSchema>;
```

zod version note: the block above is written for zod 3 semantics, where an object-level `.default({})` is parsed so inner defaults fill in. On zod 4, replace each object-level `.default({})` with `.prefault({})` and `z.string().datetime()` with `z.iso.datetime()`. The P2-T1 test "defaults fill from a minimal object" catches a wrong choice.

`Pack` (used by the engine) is the loaded datapack plus its indexes, defined in P3-T10.

Migrations: `src/data/schema/migrations.ts` exports `migrate(raw: unknown): ProfilesFile` — a chain keyed by `schemaVersion`. A file with a **higher** version than the app knows is opened read-only with a "please update the app" notice; it is never down-converted or overwritten.

### 8.5 Datapack schemas — `src/data/schema/pack.ts` (shapes; write as zod)

```ts
type Confidence = 'verified' | 'likely' | 'unverified';
type Source = { kind: 'official' | 'in-game' | 'community' | 'legacy';
                label: string; url?: string; articleId?: number; retrievedAt: string /* ISO date */ };
type Provenance = { sources: Source[] /* min 1 */; confidence: Confidence; verifiedAt: string };
type Ext = { meowdb?: string };            // id used to build a deep link

type Meta = { packVersion: string;          // "YYYY.MM.DD-n"
  gameLabel: string;                        // "Founder's Access"
  levelCap: number; charactersPerAccount: number;
  jobAdvancements: { level: number; from: JobId; to: JobId[]; npcId: string }[];
  regionsAvailable: string[];               // regions that exist in the live game
  gatedRegions: string[];                   // subset a character must unlock first (matched against profile.unlocks.areas)
  defaultRespawnSec: number | null;
  reviewedThroughArticleId: number; reviewedAt: string };

type Monster = Provenance & { id: string; name: string; level: number; hp: number; exp: number;
  mp?: number; touchDmgMin?: number; touchDmgMax?: number; pdef?: number; mdef?: number;
  accuracy?: number; avoid?: number; boss: boolean; undead?: boolean;
  weak?: string[]; strong?: string[]; mesoMin?: number; mesoMax?: number;
  image?: string; ext?: Ext };

type GameMap = Provenance & { id: string; name: string; region: string; isTown: boolean;
  spawns: { mobId: string; count: number; respawnSec?: number }[];
  links: { to: string; kind: 'portal' | 'taxi' | 'ship' | 'hidden'; costMeso?: number; note?: string }[];
  npcIds: string[]; hasPotionShop?: boolean; image?: string; ext?: Ext };

type Item = Provenance & { id: string; name: string;
  category: 'equip' | 'use' | 'etc' | 'setup' | 'cash'; slot?: string; weaponType?: string;
  reqLevel?: number; reqJobs?: ('warrior'|'magician'|'bowman'|'thief'|'beginner')[];
  stats?: Record<string, number>; npcSellMeso?: number; tags: string[];
  rarity?: 'common' | 'uncommon' | 'rare' | 'very-rare'; image?: string; ext?: Ext };

type Rate = { kind: 'exact'; pct: number }                       // official only
          | { kind: 'sampled'; drops: number; kills: number }
          | { kind: 'tier'; tier: 'common' | 'uncommon' | 'rare' | 'very-rare' }
          | { kind: 'unknown' };
type Drop = Provenance & { mobId: string; itemId: string;
  status: 'confirmed' | 'reported' | 'legacy-unverified'; rate: Rate };

type Npc = Provenance & { id: string; name: string; mapId: string; role?: string; image?: string; ext?: Ext };

type QuestStep = { text: string; kind: 'talk' | 'kill' | 'collect' | 'travel' | 'deliver';
  npcId?: string; mapId?: string; mobId?: string; itemId?: string; qty?: number };
type Quest = Provenance & { id: string; name: string;
  category: 'regular' | 'job' | 'citizenship' | 'event' | 'party';
  minLevel: number; maxLevel?: number; jobs?: JobId[]; prereqQuestIds: string[];
  startNpcId: string; steps: QuestStep[];
  rewards: { exp?: number; meso?: number; fame?: number; items?: { itemId: string; qty: number; choice?: boolean }[] };
  missable?: boolean; repeatable?: boolean; chainId?: string; chainIndex?: number;
  availableFromUtc?: string; availableUntilUtc?: string; videoIds?: string[]; ext?: Ext };

type TrainingSpot = Provenance & { id: string; mapId: string; mobIds: string[];
  bands: { archetype: 'melee' | 'ranged' | 'mage' | 'any'; jobs?: JobId[]; min: number; max: number }[];
  party: 'solo' | 'party' | 'either'; popularity: 1 | 2 | 3 | 4 | 5;
  mobilitySec?: number; notes: string; safeSpot?: string; potionAdvice?: string;
  tags: string[]; videoIds: string[] };

type Skill = Provenance & { id: string; name: string; jobId: JobId; maxLevel: number;
  kind: 'attack' | 'buff' | 'passive' | 'other';
  levels?: { level: number; damagePct?: number; hits?: number; targets?: number; mpCost?: number }[];
  image?: string; ext?: Ext };

type Video = { id: string /* YouTube id */; title: string; channel: string; lang: string;
  topics: { kind: 'spot' | 'quest' | 'job' | 'boss' | 'pq' | 'general'; refId?: string }[];
  appliesTo: string /* gameLabel it was checked against */; addedAt: string; lastCheckedAt: string;
  status: 'ok' | 'removed' };

type GameEvent = Provenance & { id: string; title: string; kind: 'event' | 'gm-event' | 'sale' | 'deadline';
  windows: { startUtc: string; endUtc: string | null }[];
  minLevel?: number; howTo: string; rewards: string; articleId: number; articleHash: string };

type Formulas = { expToNext: number[] | null;                    // index = level
  levelPenalty: { verified: boolean; table: { diff: number; mult: number }[] } | null;
  hitChance: { verified: boolean; kind: string; params: Record<string, number> } | null;
  defaultAttackIntervalSec: number; aoeEfficiency: number /* heuristic, default 0.5 */; tierWeights: Record<'common'|'uncommon'|'rare'|'very-rare'|'unknown', number> };
```

Archetype mapping (in `jobs.json`): warrior family + bandit → `melee`; bowman family + assassin → `ranged`; magician family → `mage`; beginner → `melee`.

**Validator rules (P3-T2) — any failure fails the build:**
1. Every record parses against its schema; ids unique per type.
2. Referential integrity: every `mobId`, `itemId`, `mapId`, `npcId`, `questId`, `videoId` referenced exists.
3. `sources.length ≥ 1`; `verifiedAt` and `retrievedAt` not in the future.
4. `confidence: 'verified'` requires at least one `official` or `in-game` source.
5. `rate.kind === 'exact'` requires an `official` source.
6. A record whose only sources are `legacy` must have `confidence: 'unverified'`, and a drop with only legacy sources must have `status: 'legacy-unverified'`.
7. `monster.level ≤ meta.levelCap + 30`; spot `bands` have `min ≤ max`; quest `minLevel ≥ 1`.
8. Map links: if A links to B by `portal`, B must link to A or carry `note: "one-way"`.
9. Every `TrainingSpot.mapId` has at least one spawn for each `mobIds` entry.
10. Events: `articleHash` present; each window has `startUtc < endUtc` when `endUtc` is set.
11. `meta.reviewedThroughArticleId` is set; `gatedRegions ⊆ regionsAvailable`; every map's `region` is in `regionsAvailable`.
12. Every `skill.jobId` is a known job; `levels[].level ≤ maxLevel`.
13. `ext.meowdb`, when present, matches `^[0-9]{1,12}$` (ids only — no URLs, no slugs).

### 8.6 Datapack feed, manifest and install algorithm

`manifest.json` (published beside the pack files) plus detached `manifest.json.sig` (minisign format, produced by `tauri signer sign`; public key compiled into the exe):

```json
{
  "schema": 1,
  "packVersion": "2026.10.07-1",
  "builtAt": "2026-10-07T02:10:00Z",
  "minAppVersion": "0.1.0",
  "gameLabel": "Founder's Access",
  "reviewedThroughArticleId": 45621,
  "files": [ { "path": "monsters.json", "sha256": "<hex>", "bytes": 12345 } ]
}
```

Install algorithm (the UI's `updateClient.ts` drives steps 1–6; Rust `datapack.rs` does 2 and 7–10):

1. UI: GET manifest + signature (8 s timeout, `If-None-Match`). 304 or network error → keep current, record `lastCheckedAt` / offline.
2. UI → `pack_verify_manifest`. Rust verifies the signature over the exact manifest bytes. Not ok → abort, log, keep current. Nothing else is downloaded before this passes.
3. UI: if `packVersion` ≤ active version → done. Compare as the tuple `(YYYY, MM, DD, n)`. The "active version" is the newer of the installed pack and the bundled baseline.
4. UI: if `minAppVersion` > app version → keep current; show "App update needed for the newest guide data".
5. UI: download only files whose `sha256` differs from the active pack's manifest; read unchanged ones with `pack_read` (or from the bundle).
6. UI: assemble the full candidate pack in memory, zod-parse every file and run validator rules 1–2. Fail → abort, keep current. (Nothing has touched disk yet.)
7. UI → `pack_install` with the manifest, signature and the **changed** files. Rust: re-verify the signature; reject any `path` not matching `^[a-z0-9.-]+\.json$` (no slashes, no `..`); write changed files and copy unchanged files from the active pack into `packs\staging-<version>\`; if an unchanged file is not available on disk (active pack is the bundle) return an error asking for all files, and the UI retries sending every file.
8. Rust: verify every staged file's `sha256` and size against the manifest. Any mismatch → delete staging, return error.
9. Rust: rename `staging-<version>` → `packs\<version>`; write `current.txt` atomically (temp → rename); keep the two previous packs, delete older ones.
10. On any launch, if the active pack fails to load or parse → roll back to the previous installed pack, then to the bundled baseline, and show a one-line notice.

The bundled baseline is `dist-datapack\` copied into the frontend build (including its `manifest.json`), so the app always knows the baseline's version.

### 8.7 Engine contract — `src/engine/`

```ts
// weights.ts
export type SubscoreKey = 'exp' | 'meso' | 'drop' | 'equip' | 'safety' | 'convenience';
export const DEFAULT_FOCUS_WEIGHTS: Record<FocusId, Record<SubscoreKey, number>> = {
  'exp':         { exp: 0.65, meso: 0.05, drop: 0.05, equip: 0.05, safety: 0.12, convenience: 0.08 },
  'rare-drop':   { exp: 0.15, meso: 0.05, drop: 0.55, equip: 0.05, safety: 0.12, convenience: 0.08 },
  'class-equip': { exp: 0.15, meso: 0.05, drop: 0.05, equip: 0.55, safety: 0.12, convenience: 0.08 },
  'meso':        { exp: 0.15, meso: 0.55, drop: 0.10, equip: 0.00, safety: 0.12, convenience: 0.08 },
  'balanced':    { exp: 0.30, meso: 0.18, drop: 0.16, equip: 0.16, safety: 0.12, convenience: 0.08 },
};  // each row sums to 1.00; datapack `focus-profiles.json` may override

export function bandFit(level: number, min: number, max: number): number {
  if (level >= min && level <= max) return 1;
  if (level < min) return Math.max(0, 1 - (min - level) / 3);   // 0 at min-3
  return Math.max(0, 1 - (level - max) / 5);                    // 0 at max+5
}

export function finalScore(sub: Record<SubscoreKey, number>, w: Record<SubscoreKey, number>,
                           fit: number, confidence: Confidence): number {
  const conf = { verified: 1, likely: 0.95, unverified: 0.85 }[confidence];
  const base = (Object.keys(w) as SubscoreKey[]).reduce((s, k) => s + w[k] * sub[k], 0);
  return base * fit * conf;
}

export function pickPlan<T extends { score: number; mapId: string }>(ranked: T[], maxBackups = 3) {
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const primary = sorted[0] ?? null;
  const used = new Set<string>(primary ? [primary.mapId] : []);
  const backups: T[] = [];
  for (const c of sorted.slice(1)) {
    if (backups.length >= maxBackups) break;
    if (used.has(c.mapId)) continue;        // a backup must be a different map
    used.add(c.mapId); backups.push(c);
  }
  return { primary, backups };
}
```

Required unit tests for the above: `bandFit(20,20,30)=1`, `bandFit(19,20,30)≈0.667`, `bandFit(17,20,30)=0`, `bandFit(32,20,30)=0.6`, `bandFit(35,20,30)=0`; every weights row sums to 1 (±1e-9); `finalScore` with all subscores 1, fit 1, `verified` = 1; `pickPlan` never returns a backup sharing the primary's `mapId`, returns `primary: null` for an empty list, and is stable for equal inputs.

```ts
// recommend.ts
export type Range = { low: number; high: number };
export type Estimate = { basis: 'computed' | 'level-band';
  hitsToKill: number | null; killsPerHour: Range | null; expPerHour: Range | null; mesoPerHour: Range | null;
  danger: 'safe' | 'caution' | 'dangerous' | 'unknown' };
export type Reason = { code: string; params: Record<string, string | number> };
export type Recommendation = { spotId: string; mapId: string; score: number; fit: number;
  subscores: Record<SubscoreKey, number>; estimate: Estimate;
  reasons: Reason[]; warnings: Reason[]; notableDropItemIds: string[]; confidence: Confidence; stretch: boolean };
export type TrainingPlan = { primary: Recommendation | null; backups: Recommendation[]; considered: number;
  emptyReason?: 'no-data-for-level' | 'all-skipped' };
export function recommendTraining(input: { profile: Profile; pack: Pack; now: Date }): TrainingPlan;
```

**Algorithm (implement exactly; all constants come from `formulas.json` / `focus-profiles.json` with these defaults):**

0. **Definitions.** A spot's mobs are `spot.mobIds`; each mob's weight `wᵢ` is its spawn `count` on the spot's map divided by the total count of the spot's mobs there. "Weighted X" means `Σ wᵢ × Xᵢ`. `respawn = spawn.respawnSec ?? meta.defaultRespawnSec`. The basis (`computed` vs `level-band`) depends only on the profile, so it is the same for every candidate in one run and subscores are always compared like with like.
1. **Candidates.** For each spot: pick its best band for the profile (a `jobs` match beats an archetype match beats `any`); `fit = bandFit(level, band.min, band.max)`. Exclude the spot if `fit == 0`; if its map's region is not in `meta.regionsAvailable`; if the region is in `meta.gatedRegions` and not in `profile.unlocks.areas`; if it is on the profile's unexpired skip list (`until > now`); or if `party == 'party'` (party spots are listed separately as "needs a party"). Count how many were excluded *only* by the skip list — if that leaves no candidates, `emptyReason = 'all-skipped'`.
2. **Estimate.**
   - `basis = 'computed'` when both `combat.damageMin` and `combat.damageMax` are set and > 0. Then per mob: `avg = (min+max)/2`. If `combat.mainSkillId` names an `attack` skill in the pack, the profile's level in it is > 0 and that level has `damagePct`: `perAttack = avg × damagePct/100 × (hits ?? 1)` and `targets = skill.targets ?? 1`; otherwise `perAttack = avg`, `targets = 1`. `hitsToKillᵢ = ceil(hpᵢ / perAttack)`. `hitChance` = formula result only if `formulas.hitChance?.verified`, else `1` for mages and `0.9` otherwise (add warning `hit-chance-assumed`). `secPerKillᵢ = hitsToKillᵢ × defaultAttackIntervalSec / hitChance + (spot.mobilitySec ?? 1.5)`. `aoe = 1 + aoeEfficiency × (min(targets, 6) − 1)`. `playerKph = aoe × 3600 / (weighted secPerKill)`. `spawnKph = Σ countᵢ × 3600 / respawn` (if there is no respawn data at all, `spawnKph = ∞`). `kph = min(playerKph, 0.85 × spawnKph)`. `expPerHour = kph × weighted (expᵢ × penaltyᵢ)` where `penaltyᵢ` comes from `formulas.levelPenalty` only if verified, else 1. `mesoPerHour` as in step 3. Ranges are `mid × 0.8 … mid × 1.2`. The reported `hitsToKill` is that of the highest-count mob.
   - Otherwise `basis = 'level-band'`: all numeric rates are `null`; for ranking use `kph = Σ countᵢ / respawn` (or `Σ countᵢ` if there is no respawn data) — a relative density, never displayed.
   - `danger`: needs `stats.hp` and the largest `touchDmgMax` among the spot's mobs: `hitsToDie = hp / touchDmgMax` → `≥ 8` safe, `≥ 4` caution, else dangerous; missing either → unknown.
3. **Subscores (each 0…1, normalised by the max among candidates; if the max is 0 the subscore is 0 for all).**
   - `exp`: `kph × weighted exp` (with penalties when computed).
   - `meso`: `kph × (weighted (mesoMin+mesoMax)/2, 0 if unknown, + Σ over the spot's drops of wᵢ × item.npcSellMeso × w(rate))`.
   - `drop`: `Σ wᵢ × w(rate) × desirability` over the spot's drops where the item is rare/very-rare or on the profile wishlist. `desirability`: rare 1, very-rare 2, otherwise 1; multiplied by 3 if wishlisted.
   - `equip`: `Σ wᵢ × w(rate)` over dropped equips whose `reqJobs` is empty or includes the profile's job family and whose `reqLevel ∈ [level, level + 10]`.
   - `safety`: safe 1, caution 0.6, unknown 0.6, dangerous 0.15.
   - `convenience`: `1 − min(hopsFromNearestTown, 8) / 8`, using `route.ts` over `portal` links to the nearest `isTown` map; unreachable or unknown → 0.5.
   - `w(rate)`: exact → `pct/100`; sampled → `drops/kills`; tier/unknown → `formulas.tierWeights` (defaults: common 0.05, uncommon 0.01, rare 0.002, very-rare 0.0005, unknown 0.001). Drops with `status: 'legacy-unverified'` are ignored.
4. **Score** = `finalScore(subscores, weights[profile.focus], fit, spot.confidence)`.
5. **Plan** = `pickPlan(candidates)`. If there is a primary but no backup, re-run step 1 with relaxed bands (fit reaches 0 at `min−5` / `max+8`), score those, and append the best ones on different maps as backups marked `stretch: true` with warning `stretch-option`. If there is no primary even after relaxing: `primary: null` with `emptyReason` (`'all-skipped'` per step 1, else `'no-data-for-level'`). The UI then shows quests for the level and a "data for this level is still being collected" note — never an invented spot.
6. **Reasons:** up to 3, from the largest `weight × subscore` contributions, e.g. `{code:'best-exp', params:{rank:1, of:14}}`, `{code:'drops-class-equip', params:{itemId}}`, `{code:'near-town', params:{mapId, hops:2}}`. Warnings: `dangerous-mob`, `hit-chance-assumed`, `estimate-from-level-only`, `unverified-data`, `stretch-option`.
7. **Deterministic:** same input → same output (ties broken by `spotId`).

"Map taken?" in the UI appends `{ spotId, until: now + 90 min }` to `profile.skippedSpots` and recomputes; "Reset skipped spots" clears it.

### 8.8 Sydney time — `src/lib/sydney.ts` (ported from Astra `app/timing.mjs`)

```ts
export const SYDNEY = 'Australia/Sydney';

export function zonedParts(input: string | Date, timeZone: string = SYDNEY) {
  const instant = new Date(input);
  if (!Number.isFinite(instant.getTime())) throw new Error('Invalid timestamp');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const wall = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  const offsetMin = Math.round((Date.parse(wall + 'Z') - instant.getTime()) / 60000);
  const zone = timeZone !== SYDNEY ? '' : offsetMin === 660 ? 'AEDT' : offsetMin === 600 ? 'AEST' : '';
  return { wall, offsetMin, zone };
}
```

Required tests (all must pass exactly):

| Input (UTC) | Expected Sydney wall | Zone | Why |
|---|---|---|---|
| `2026-10-06T18:00:00Z` | `2026-10-07T05:00:00` | AEDT | Founder's Access start |
| `2026-10-21T18:00:00Z` | `2026-10-22T05:00:00` | AEDT | Grand Launch |
| `2026-10-20T23:59:00Z` | `2026-10-21T10:59:00` | AEDT | Founder's First Step ends |
| `2026-10-15T06:59:00Z` | `2026-10-15T17:59:00` | AEDT | package sale ends |
| `2026-11-30T23:59:00Z` | `2026-12-01T10:59:00` | AEDT | package claim deadline |
| `2026-10-03T15:59:59Z` | `2026-10-04T01:59:59` | AEST | last second before DST starts |
| `2026-10-03T16:00:00Z` | `2026-10-04T03:00:00` | AEDT | DST starts (clock jumps 2→3) |
| `2027-04-03T15:59:59Z` | `2027-04-04T02:59:59` | AEDT | last second before DST ends |
| `2027-04-03T16:00:00Z` | `2027-04-04T02:00:00` | AEST | DST ends (clock falls 3→2) |

Also port `parseExplicitTimes` (source abbreviations carry their stated fixed offset; a source "AEST" is UTC+10 even in summer) and its tests from `timing.test.mjs`.

---

## 9. UX blueprint

### 9.1 Navigation

Left rail (icon + label): **Home · Train · Loot · Gear · Quests · News · Characters**. Top bar: active-character chip (thumbnail, name, `Lv 23 Bandit`, level `−`/`+` stepper), focus badge, data-freshness pill, settings. `Ctrl+1…7` switch sections. The last screen and scroll position are restored per character.

### 9.2 Screens (what is visible vs collapsed)

| Screen | Visible at once | Collapsed until asked |
|---|---|---|
| First run | 3-step wizard: (1) name + class, (2) level + job, (3) focus. Optional "Paste a screenshot (Ctrl+V)". | Stats, skills, unlocks ("Add later for sharper tips") |
| Home | "Train here now" card · "Next 3 quests" · "Ending soon" events (Sydney time) · journey strip (Lv 1 → 10 → 30 → 100 with the next milestone) | Everything else |
| Train | Focus switcher (5 segments) · primary spot card (map image, monsters, one-line why, EXP/h if computable, confidence chip) · **"Map taken? Show backup"** button · backup strip (1–3 small cards) | Why this spot · Monsters · Drops · How to get there · Potions/safety · Video · Sources |
| Loot | Search box · "Best targets for you" (3 cards) · wishlist | Per item: where it drops, rate label (§6.3), which mobs, source |
| Gear | "Next upgrades for <job> at Lv N" by slot (max 5 rows) | How to get each (drop / craft / shop / quest) |
| Quests | Tabs: Available now · Coming soon · Done. Top 5 "worth doing" first. | Steps checklist · where to go · rewards · route · video |
| News | Tabs: Now · Upcoming · Past · Needs review. Countdown chips. | Article text, original source time, link to Nexon |
| Characters | Slot grid (card = screenshot, name, level, job, focus, last played) · "New character" | Edit sheet: identity · stats · combat · skills · unlocks · notes · export |
| Settings | Time zone mode · motion · theme · where data is stored · backups · about/credits/disclaimer | |

### 9.3 Character screenshot paste

Listen for `paste` on the Characters editor and wizard: take the first `clipboardData.items` entry with `type` starting `image/` → `getAsFile()` → draw to a canvas → crop dialog (drag/zoom, 3:4 portrait) → export WebP at ≤ 512 px long edge → `screenshot_save`. Also accept drag-and-drop and a file picker. Show the hint "Press Win+Shift+S in game, then Ctrl+V here."

### 9.4 Motion

Page cross-fade + 8 px slide (180 ms); accordion spring; card swap animation when the backup becomes primary; number tickers for EXP/h; level-up leaf burst when the level stepper increases; skeleton shimmer while loading; hover lift on cards. Honour `prefers-reduced-motion` and the Settings override — reduced mode keeps fades only.

### 9.5 Visual direction

> **Superseded 2026-10-05 (the owner):** "Maple Glass" — an iOS 26/27 Liquid Glass feel: frosted translucent panels over a slow-drifting warm sunset backdrop, pill buttons with spring press, iOS segmented control/stepper/switches, floating glass nav with a sliding highlight, Dynamic-Island-style toasts, day + night themes, Bricolage Grotesque (display) + Figtree (body) bundled locally (OFL), Lucide icons (ISC). Tokens live in `src/index.css`; kit in `src/ui/`. The paragraph below is kept for history only.


Warm, nostalgic, storybook: parchment panels, maple orange and leaf green accents, soft drop shadows, a pixel-style display face for headings with a clean sans for body text, day and night themes. Original icons only — do not use Nexon logos or UI rips as app branding. Use the frontend-design skill when building P5-T1, and show the owner one mock screen for G-5 before building the rest.

### 9.6 Video

Lite embed: show the thumbnail (`https://i.ytimg.com/vi/<id>/hqdefault.jpg`) and title; on click, mount `<iframe src="https://www.youtube-nocookie.com/embed/<id>?rel=0" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen">`. Always offer "Open on YouTube" (default browser). Videos marked `removed` by the checker are hidden.

---

## 10. Phases and tasks

Legend: **Files** = create/modify · **Verify** = command and expected result · tick only after Verify passes.

### Phase 0 — Decisions & groundwork

- [x] **P0-T1** the owner answers G-1…G-7; record in §2. (Done 2026-10-05. P0-T4 is cancelled: G-1 = link out only.)
- [x] **P0-T3 (do first)** Get onto a path without `&`. Probe already run on 2026-10-05 in `<parent folder>\Maplestory Classic Training & Leveling Guide`: a plain `node -e` script works, but any npm bin shim fails (`'Leveling' is not recognized as an internal or external command`), so Vite/Tauri/Vitest cannot run there. Choose one and record it in §15:
  - **Option 1 (preferred): The owner renames the folder** in File Explorer to a name without `&`, e.g. the project folder (spaces are fine), and opens the next AI session in the renamed folder.
  - **Option 2 (tested working for npm shims):** keep the folder and create a junction, then run every command from the junction path: `New-Item -ItemType Junction -Path 'E:\dev\mcc' -Target '<parent folder>\Maplestory Classic Training & Leveling Guide'` (create `E:\dev` first). To remove a junction later use `(Get-Item 'E:\dev\mcc').Delete()` — never `Remove-Item -Recurse`, which can delete the real files.
  - **Verify (either option):** in the clean path, in a temp subfolder with `{"scripts":{"bin":"semver 1.2.3 -i minor"},"devDependencies":{"semver":"^7.0.0"}}`, `npm install` then `npm run bin` prints `1.3.0`. Delete the temp subfolder.
- [x] **P0-T2** Initialise git in the clean path. `git init -b main`; create `.gitignore` with `node_modules/`, `dist/`, `dist-datapack/`, `src-tauri/target/`, `MapleClassicCompanion-data/`, `field-notes/`, `*.key`, `.env*`; commit `MASTER_PLAN.md`. Do not add the GitHub remote or push yet (that is P8-T1). **Verify:** `git log --oneline` shows one commit.
- [x] **P0-T4** ~~Send the Appendix A email~~ — cancelled (G-1 = link out only).
- [x] **P0-T5** Record toolchain versions in §15 (known on 5 Oct 2026: Node 22.23.2, npm 10.9.8, rustc 1.95.0 msvc, VS 2022 Community with C++ tools, WebView2 154.0.4258.53, git 2.49, Python 3.10.11; `gh` and `pnpm` not installed).

### Phase 1 — Skeleton + risk spikes (no gate)

Exit demo: a single exe, copied to another folder, that opens, remembers a value after restart via a data folder beside it, accepts a pasted screenshot, and plays a YouTube video.

- [x] **P1-T1** Scaffold. From the clean project path (P0-T3): `npm create tauri-app@latest mcc-scaffold -- --template react-ts --manager npm --identifier com.vicioustaco.mapleclassiccompanion --tauri-version 2 --yes` (flags confirmed against create-tauri-app 4.7.4 on 2026-10-05). Append the scaffold's `.gitignore` lines to the existing root `.gitignore`, delete the scaffold's copy, move everything else (including dot-files) into the root with `Get-ChildItem -Force mcc-scaffold | Move-Item -Destination .`, remove the empty folder, then `npm install`. Rename the package in `package.json` and `src-tauri/Cargo.toml` to `maple-classic-companion`. If a flag is rejected, run `npm create tauri-app@latest -- --help` and adapt; the required outcome is a Tauri 2 + React + TypeScript + Vite project at the repo root. Set in `tauri.conf.json`: `productName: "Maple Classic Companion"`, `mainBinaryName: "MapleClassicCompanion"`, window 1280×800 with min 1024×640, `bundle.active: false`. **Verify:** `npm run tauri dev` opens a window. Record resolved versions of tauri, react, vite in §15.
- [x] **P1-T2** Tooling: Tailwind, Vitest (+ jsdom, React Testing Library), ESLint + Prettier, `tsconfig` strict. Scripts: `test`, `lint`, `typecheck`, `build:exe` (= `tauri build --no-bundle`). Add `src-tauri/.cargo/config.toml` with `[target.x86_64-pc-windows-msvc] rustflags = ["-C", "target-feature=+crt-static"]` so the exe needs no VC++ redistributable. **Verify:** `npm test` runs one passing sample test; `npm run typecheck` is clean.
- [x] **P1-T3** Portable paths. **Files:** `src-tauri/src/paths.rs` (§8.1), `lib.rs`. Call `resolve_from_env()` first thing in `run()`, then set env `WEBVIEW2_USER_DATA_FOLDER = <data>\webview` before `tauri::Builder` (wrap in `unsafe {}` if the crate is on edition 2024). If `tauri::webview_version()` errors, show a native message box explaining WebView2 is required, with the Microsoft download link, and exit. If P1-T7 later shows WebView2 still writing under `%LOCALAPPDATA%`, remove the window from `tauri.conf.json` and create it in Rust `setup` with `WebviewWindowBuilder::new(...).data_directory(<data>\webview)` instead. **Verify:** `cargo test --manifest-path src-tauri/Cargo.toml paths` → 3 passed.
- [x] **P1-T4** Atomic storage + IPC. **Files:** `storage.rs` (§8.2), commands `get_paths`, `profiles_load`, `profiles_save`; `src/platform/ipc.ts`, `ipc.mock.ts`. Add `tauri-plugin-single-instance`. **Verify:** `cargo test storage` passes tests for: valid save round-trips; invalid JSON refused and original untouched; corrupt file → restored from newest good backup and corrupt copy kept; backups pruned to 20.
- [x] **P1-T5** Spike — clipboard image paste (§9.3) saving through a temporary `screenshot_save`. **Verify (manual, in the built exe):** Win+Shift+S → Ctrl+V shows the image; restart → still shown; file exists under `…-data\screenshots\`.
- [x] **P1-T6** Spike — YouTube lite embed (§9.6) with CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com https://g.nexonstatic.com https://www.nexon.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com; connect-src 'self' ipc: http://ipc.localhost; font-src 'self' data:`. **Verify (built exe):** a known public video plays with sound; no "Error 153"; the "Open on YouTube" button opens the default browser. If embed fails after trying the `www.youtube.com/embed` host and referrer policy, keep the thumbnail-card + open-in-browser path and log the limitation in §15.
- [x] **P1-T7** Spike — portable build. `npm run build:exe`; copy `src-tauri\target\release\MapleClassicCompanion.exe` alone to `test-run\` (project folder) and run. **Verify:** runs with no installer; creates `MapleClassicCompanion-data\` beside itself (including `webview\`); nothing new under `%LOCALAPPDATA%\com.vicioustaco.mapleclassiccompanion`; record exe size and cold-start time in §15 (targets: < 25 MB, < 2 s).
- [x] **P1-T8** Spike — signing and self-replace. Generate a keypair with `npm run tauri signer generate` (private key stays outside the repo; the owner stores it in a password manager). Prove in a Rust test that `minisign-verify` accepts a file signed with `tauri signer sign` and rejects a one-byte-modified file. Prove with the `self-replace` crate that a running exe can swap itself and relaunch. **Verify:** both tests pass; manual swap demo works.
- [x] **P1-T9** Spike report: write results into §15; apply the D-1 fallback rule if needed. Update §1.

### Phase 2 — Characters & persistence (gate G-6 for T5 unlock list)

Exit demo: create three characters, paste screenshots, edit everything, kill the process mid-edit, reopen — nothing lost.

- [x] **P2-T1** `src/data/schema/profile.ts` (§8.4) + `migrations.ts`. **Verify:** Vitest — defaults fill from a minimal object `{id,name,createdAt,updatedAt,jobId,level}`; level 0 and 301 rejected; unknown `jobId` rejected; a file with `schemaVersion: 2` yields the read-only result.
- [x] **P2-T2** Profile store (Zustand): load on start, 400 ms debounced save, flush on window close, `restoredFromBackup` notice. **Verify:** Vitest with the IPC mock and fake timers — 10 rapid edits produce 1 save; `flush()` saves immediately.
- [x] **P2-T3** Characters screen: slot grid, create, switch, duplicate, archive, delete (confirm dialog + 10 s undo toast). No hard limit on slots; show a gentle note that the game allows 3 per account. **Verify:** RTL tests for create/switch/delete-undo.
- [x] **P2-T4** First-run wizard (§9.2). Finishing lands on Home with a recommendation area visible. **Verify:** RTL — completing 3 steps creates a valid profile and sets it active.
- [x] **P2-T5** Character sheet: identity; level stepper (clamped to `pack.meta.levelCap`); job picker that only offers jobs valid for the level (from `meta.jobAdvancements`: Lv 10 and Lv 30); stats; combat (damage range "as shown in your in-game stat window"); unlock checklists (per G-6). Soft validation only (warnings, never blocks saving). **Verify:** RTL — at Lv 9 only Beginner is offered; at Lv 30 a Thief can pick Assassin or Bandit.
- [x] **P2-T6** Screenshot: paste, drag-drop, file picker, crop, replace, remove; final commands `screenshot_save/read/delete` with size/type checks. **Verify:** Rust tests reject > 400 KB and non-image bytes; manual paste works in the exe.
- [x] **P2-T6b** Quick note (I-19): toolbar button + `Ctrl+N`; paste/drop images (reuse P2-T6 component, no crop), text box, optional URL, optional entity link; Rust command `field_note_save` writes `field-notes\inbox\<stamp>
ote.json` + `img-<n>.webp` inside the data folder (shown in Settings with an "Open folder" button). **Verify:** RTL with the IPC mock; Rust test writes a note and rejects non-image bytes.
- [x] **P2-T7** Skills editor: list skills for the job line from the pack; per-skill stepper 0…max; if the pack has no skill data for the job, show "Skill details are not in the guide data yet" (no invented skills). **Verify:** RTL with a fixture pack.
- [x] **P2-T8** Export / import a character (`.json`, schema-validated on import; import always creates a new id) and a "Restore from backup" list in Settings. **Verify:** round-trip test; a malformed import is rejected with a readable message.
- [x] **P2-T9** Persistence torture test (manual script in `tests/manual/persistence.md`): edit → `Stop-Process` the exe within 1 s → reopen, 10 times; move the exe + data folder to another directory; make the exe folder read-only and confirm the `%LOCALAPPDATA%` fallback notice. **Verify:** no data loss in any run; results logged in §14.

### Phase 3 — Datapack v0 — effort xhigh

Exit demo: `npm run datapack:build` produces a validated pack covering Maple Island + Victoria Island as far as permitted sources allow, plus a coverage report.

Do T1–T4 and T10 first (they unblock P4 and P5). T5–T9 are content work that continues in the background for the life of the project; they are "done for v1.0" when the P3-T8 coverage target is met.

- [x] **P3-T0** (Survey 2026-10-05 → `docs/SOURCES.md`; **The owner APPROVED all proposed statuses 2026-10-05**, incl. MapleClassic Wiki = approved under CC BY-NC-SA 4.0 with per-record citation, one page at a time, `likely` confidence.) Source survey. Search for other MapleStory **Classic World** data sources (wikis, official guide pages, creator spreadsheets). For each: URL, what it covers, licence/terms on automated use, whether its numbers are Classic World or legacy, and a recommendation. Write `docs/SOURCES.md` with a table and a status column (`approved` / `link-only` / `rejected`). **The owner approves the list** before any source other than Nexon and field notes is used. NiaMeowDB is pre-recorded as `link-only`. Re-run this survey monthly while the game is new.

- [x] **P3-T1** `src/data/schema/pack.ts` — zod for every type in §8.5. **Verify:** Vitest fixtures: one valid and one invalid example per type.
- [x] **P3-T2** `scripts/datapack-validate.ts` implementing validator rules 1–11 (§8.5), each with a failing fixture. **Verify:** `npm run datapack:validate` exits 0 on `datapack/`, and non-zero with a clear message on each bad fixture.
- [x] **P3-T3** `scripts/datapack-build.ts`: merge region files → `dist-datapack/*.json` (minified) + `manifest.json` with sha256/bytes. **Verify:** the manifest lists every output file; hashes match `Get-FileHash`.
- [x] **P3-T4** Seed official core from §5: `meta.json` (levelCap 100, jobAdvancements, regionsAvailable `["maple-island","victoria-island"]`, reviewedThroughArticleId 45621), `jobs.json`, bosses list, crafting NPCs, citizenship, party quest, `events.json` (Founder's First Step, GM events, package deadlines — with `articleHash` taken from the Astra snapshot). All `official` / `verified`. `gatedRegions: []`. `formulas.json` starts with `expToNext: null`, penalties and hit chance `null`, `defaultAttackIntervalSec: 0.8`, `aoeEfficiency: 0.5`, tier weights from §8.7. `meta.defaultRespawnSec: null` until observed in game.
- [x] **P3-T5** _(Lv 1–55 from MapleClassic Wiki 2026-10-05/06; see §14)_ Seed maps, monsters, spawns, links for Maple Island and Victoria Island from Tier A, field notes (§6.5) and sources approved in P3-T0. Each record cites its source. This will start small — that is expected; do not fill gaps with legacy numbers. Add `ext.meowdb` ids only under the link accuracy rule (§6.1). Give the owner a short "most useful things to note next" list after each batch (e.g. the level bands with fewer than 2 spots).
- [x] **P3-T6** _(Lv 1–55 from MapleClassic Wiki 2026-10-05/06; see §14)_ Seed items, drops (only `confirmed`/`reported`, rate per §6.3), `gear-progression.json`.
- [x] **P3-T7** _(Lv 1–55 from MapleClassic Wiki 2026-10-05/06; see §14)_ Seed quests: the four 1st-job and ten 2nd-job advancements first, then by level.
- [x] **P3-T8** _(Lv 1–55 from MapleClassic Wiki 2026-10-05/06; see §14)_ Seed training spots with level bands per archetype. Coverage target for v1.0: ≥ 2 spots for every 5-level band from Lv 1–50 for each archetype (so a backup always exists); extend upward as data arrives.
- [ ] **P3-T9** Seed `videos.json`: each video watched and confirmed to be about **Classic World** (not private servers or legacy), with `appliesTo` set. Start with job advancement, the Kerning party quest, and the five bosses.
- [x] **P3-T10** App loader `src/data/pack.ts`: load the active or bundled pack, zod-parse, build indexes (`byId`, `dropsByMob`, `dropsByItem`, `spotsByMap`, `questsByNpc`, link graph). Bundle `dist-datapack/` into the frontend build as the baseline: make `npm run build` run `datapack:validate` → `datapack:build` → copy to `public/baseline/` → `vite build`, and point Tauri's `beforeBuildCommand` at `npm run build`. **Verify:** Vitest — indexes correct on a fixture; a corrupt pack falls back to bundled; a build with an invalid datapack fails.
- [x] **P3-T11** `scripts/coverage-report.ts` → prints level-band × archetype spot counts, quests per band, % of records per confidence level, and gaps. **Verify:** runs; output pasted into §14.

### Phase 4 — Recommendation engine (no gate) — effort xhigh

All engine code is pure TypeScript with no React or IPC imports. Build against `tests/fixtures/pack.small.ts` (≈ 8 spots, 10 mobs, 12 items — synthetic names such as "Test Mob A" so nobody mistakes fixture numbers for game facts).

- [x] **P4-T1** `weights.ts` exactly as §8.7 + its required tests.
- [x] **P4-T2** `estimate.ts` (§8.7 step 2). Tests: 100-HP mob with damage 40–60 → `hitsToKill 2`; spawn cap binds when the player is faster than respawn; no combat stats → `basis: 'level-band'` with null rates; danger thresholds at 8 and 4; a two-mob spot weights by spawn count; an attack skill with `damagePct 200, targets 3` halves hits-to-kill and applies `aoe = 2.0`; missing respawn data → spawn cap not applied.
- [x] **P4-T3** `subscores.ts` (§8.7 step 3). Tests: normalisation to max 1; all-zero stays 0; legacy drops ignored; a wishlist item triples its contribution; equip window `[level, level+10]` and job family respected.
- [x] **P4-T4** `recommend.ts` + `reasons.ts` (§8.7 steps 1, 4–7). Tests: each of the 5 focuses picks the fixture spot designed to win it; a skipped spot is excluded until `until` passes; a party-only spot is never primary; a spot in a gated region appears only when that region is in `unlocks.areas`; skipping every candidate → `emptyReason: 'all-skipped'`; relaxed-band backup is flagged `stretch`; empty pack → `emptyReason: 'no-data-for-level'`; determinism (run twice, deep-equal).
- [x] **P4-T5** `loot.ts`: `findDropSources(itemId)` and `bestLootTargets(profile)` (top items by desirability reachable at the profile's level). Tests on the fixture.
- [x] **P4-T6** `gear.ts`: `nextUpgrades(profile)` from `gear-progression.json` — per slot, the next item at or above the current level and how to obtain it.
- [x] **P4-T7** `quests.ts`: `availableQuests(profile, now)` (level, job, prerequisites done, availability window), `comingSoon` (within 5 levels or one prerequisite away), `rankQuests` (reward EXP relative to level, shorter chains first, expiring soonest first).
- [x] **P4-T8** `route.ts`: Dijkstra over map links; cost 1 per portal, taxis/ships cost 1 plus a meso note; hidden links only if the area is unlocked. Returns ordered steps `{ from, to, kind, costMeso }`. Tests: shortest path, unreachable → `null`, one-way respected.
- [x] **P4-T9** Invariant tests over 500 seeded random profiles on the fixture: never recommends an unavailable region; primary and backups have distinct maps; scores within `[0,1]`; no thrown errors for sparse profiles.

### Phase 5 — Core UI (gate G-5 before T2)

- [x] **P5-T1** Design tokens + UI kit: Accordion (Radix, collapsed by default, remembers open state per character and screen), Card, Chip, ConfidenceChip (opens sources), Stepper, SegmentedControl, Tabs, Dialog, Toast, Skeleton, EmptyState. Produce one static mock of the Train screen → **show the owner for G-5.**
- [x] **P5-T2** App shell: nav rail, top bar, routes (hash router), per-character `lastView` restore, freshness pill (states: fresh / checking / offline / update-needed).
- [x] **P5-T3** Home (§9.2).
- [x] **P5-T4** Train screen: focus switcher writes `profile.focus`; primary card; "Map taken?" → skip + animated swap; backups; accordions; "Reset skipped spots"; "needs a party" list; when `basis: 'level-band'`, a gentle prompt "Add your damage range for EXP/hour estimates".
- [x] **P5-T5** Loot screen with search and wishlist.
- [x] **P5-T6** Gear screen.
- [x] **P5-T7** Journey strip + milestones (1st job Lv 10, citizenship Lv 12, party quest Lv 21, 2nd job Lv 30, cap Lv 100 — all read from the pack).
- [x] **P5-T8** Motion system (§9.4) + reduced-motion handling + level-up celebration.
- [x] **P5-T9** Loading, empty, offline and error states for every screen (no blank screens, no raw error text).
- [x] **P5-T10** _(keyboard nav + shortcuts, visible focus, labelled controls; contrast not instrument-measured)_ Keyboard and accessibility pass: full keyboard operation, visible focus, labelled controls, contrast ≥ 4.5:1 in both themes.
- **Verify for P5:** RTL tests per screen (renders primary + backup from the fixture; accordions start collapsed; switching focus changes the primary); Playwright smoke in browser mode with the IPC mock: wizard → Home → Train → "Map taken?" → backup becomes primary.

### Phase 6 — Quests & navigation

- [x] **P6-T1** Quest list with tabs and the "worth doing" top 5; filters collapsed.
- [x] **P6-T2** Quest detail: steps as a checklist saved per character (`questsActive` / `questsDone`), linked mobs/maps/NPCs, rewards, video, sources.
- [x] **P6-T3** Route panel: "From [town ▾]" → numbered steps from `route.ts`, with taxi/ship costs.
- [x] **P6-T4** Job advancement guides pinned at Lv 8–10 and Lv 28–30 for the character's class.
- [x] **P6-T5** Region map view (list or graph of maps by region highlighting the recommended spot and quest targets). Uses art only if G-4 allows; otherwise a clean node diagram.
- **Verify:** RTL + Playwright: tick all steps → quest moves to Done and survives restart.

### Phase 7 — News & events in Sydney time (reuses Astra; see Appendix B)

- [x] **P7-T1** Port `plainText`, `classify`, `matchReason`, `validateItem`, `CLASSIC` regex from Astra `app/core.mjs` to `src/features/news/core.ts`; port the relevant cases from `app/test.mjs`. Port `hash` (SHA-256 hex of the string, or of `JSON.stringify(value)`) and `normalize` **byte-for-byte** — the pinned hashes in the news rules and seed events depend on it. Copy three raw article files from Astra `app/data/cache/` (45621, 45385, 44134; shape `{ data: { id, name, category, liveDate, summary, body, isMSCW, … }, etag, lastModified, checkedAt }`) into `tests/fixtures/news/`. **Verify:** ported tests pass, and `normalize()` on the 45621 fixture yields `contentHash === "5e82b958d6881667735ed020810de1bb2fda23d351fb2db679457e762355d25f"` (the value Astra stored on 5 Oct 2026). If Nexon has edited the article since, re-copy the fixture and compare against the hash in the same Astra snapshot instead.
- [x] **P7-T2** News client: fetch `/news` index (498 items on 5 Oct 2026; fields `id, name, category, liveDate, summary, isMSCW, featured, imageThumbnail`); keep items where `matchReason` is non-null; fetch `/news/{id}` only for those, with ETag caching in `cache\news\`, 180 ms pacing, 3 retries, 30 s timeout. The archive feed is fetched only on first run and weekly. Guard rails from Astra: abort if the index is empty, shrinks > 10 %, or contains no `isMSCW` items. **Verify:** Vitest with a mocked fetcher covering 200/304/429/500/HTML-instead-of-JSON.
- [x] **P7-T3** `src/lib/sydney.ts` (§8.8) with the full test table, plus `parseExplicitTimes`.
- [x] **P7-T4** Port `assessArticle` from `relevance.mjs`; ship `relevance-rules.json` as `datapack/news-rules.json` (content-hash-pinned, so a changed article falls back to "Needs review").
- [x] **P7-T5** Events UI: countdown chips ("Ends in 3 d 4 h · Wed 21 Oct, 10:59 am AEDT"), recurring windows, "original source time" tooltip. If an event's `articleHash` no longer matches the live article → flag "Details changed — check the article".
- [x] **P7-T6** News screen with reader (plain text only) and "Open on nexon.com". Work out the thumbnail base URL by inspecting the official news page once; if it cannot be confirmed, omit thumbnails rather than guess.
- [x] **P7-T7** Patch-staleness banner: if the newest Classic article classified `Update` has an id not covered by `meta.reviewedThroughArticleId` → "Nexon posted '<title>' on <Sydney date>. The guide data hasn't been checked against it yet."
- [x] **P7-T8** Home "Ending soon" card.

### Phase 8 — Live updates (gates G-2, G-3, G-7) — effort xhigh

- [x] **P8-T1** _(pushed 2026-10-06 as a single clean commit by ViciousTaco/noreply; owner still to switch Pages to GitHub Actions and add the MCC_SIGNING_KEY secret)_ GitHub hookup (repo already exists: public, empty, `maple-classic-companion`). Steps: (1) ask the owner for the GitHub username; record it in §2 G-2 and replace every `ViciousTaco` in config. (2) `git remote add origin https://github.com/ViciousTaco/maple-classic-companion.git`; `git push -u origin main` — the owner completes the browser sign-in prompt themselves; never ask for or type their password or a token. (3) The owner clicks: repo → Settings → Pages → Source: **GitHub Actions**. (4) The owner clicks: repo → Settings → Secrets and variables → Actions → New repository secret, name `MCC_SIGNING_KEY`, value = the private key from P1-T8 (and `MCC_SIGNING_KEY_PASSWORD` if one was set). (5) Compile the matching public key into the exe. Before the first push, confirm `git status` shows no `MapleClassicCompanion-data/`, `field-notes/`, key files or screenshots — the repo is public. **Verify:** the Pages URL serves `datapack/manifest.json` after the first publish workflow run.
- [x] **P8-T2** `scripts/sign.ts` + build step producing `manifest.json.sig`.
- [x] **P8-T3** `datapack.rs` implementing §8.6 steps 2, 5–10. **Verify:** Rust tests — good pack installs; bad signature rejected; hash mismatch rejected and staging removed; rollback when the active pack is missing; old packs pruned to 2.
- [x] **P8-T4** `src/data/updateClient.ts`: on launch and every 30 min; hot-swap the pack store; toast; pill states. **Verify:** Vitest with mocked IPC/HTTP for each branch of §8.6.
- [x] **P8-T5** GitHub Actions: `ci.yml` (lint, typecheck, tests, validator on every PR); `datapack-publish.yml` (on merge to main: validate → build → sign → deploy Pages); `video-check.yml` (daily: YouTube oEmbed for each video → mark `removed`, open a PR); `news-watch.yml` (every 30 min: new Classic `Update` article not covered by `reviewedThroughArticleId` → open an issue "Data review needed"). Note: GitHub pauses scheduled workflows after 60 days without repo activity, so these are conveniences only — the in-app staleness banner (P7-T7) is the guarantee and must not depend on them.
- [x] **P8-T6** App self-update: `releases/latest.json` `{ version, notes, url, sha256 }` + signature → banner "Version X is ready" → on confirm: download to `<exe>.new`, verify hash and signature, `self-replace`, relaunch; keep `<exe>.old` until the next successful start. Never auto-applies without a click.
- [x] **P8-T7** _(covered by automated tests: offline, 304, bad signature, HTML/garbage, minAppVersion too new, hash mismatch, rollback; disk-full not simulated)_ Failure drills (manual, logged): offline launch; feed returns HTML; truncated download; wrong signature; `minAppVersion` too new; disk full simulation. In every case the app opens with the last good data.

### Phase 9 — Media & polish (gate G-4)

- [x] **P9-T1** _(own picture → cached wiki picture → placeholder; Find image; real map pictures for all 187 maps)_ Image pipeline per G-4, in this priority order per record: The owner's own pasted image → pack `image` URL → neutral placeholder icon.
  - (i) **Paste-your-own:** every monster/map/item/NPC card accepts Ctrl+V, drag-drop or file pick (reuse the §9.3 component without the portrait crop; keep aspect ratio, ≤ 512 px, WebP) → `entity_image_save`. "Remove my image" restores the default.
  - (ii) **Find image button** on each card opens the Google Images search URL from §8.3 in the default browser. The app never downloads search results itself.
  - (iii) **Sprite source spike:** test a public sprite API for 10 Classic World monster names; check its terms and uptime; adopt only if every sampled name resolves to the correct monster — then add its host to the CSP `img-src` and record it in `docs/SOURCES.md`. Otherwise skip.
  - Add Settings → "Sources & credits" listing every source, plus the D-11 disclaimer.
  - **Verify:** RTL — pasted image shows and persists via the IPC mock; removing it restores the fallback; Rust tests reject bad `kind`/`id` and oversize files.
- [x] **P9-T2** _(original app icon; Lucide (ISC) for UI icons)_ Original SVG icon set: 5 classes, 5 focus paths, nav, confidence levels.
- [x] **P9-T3** _(pack parse 74 ms cold / ~12 ms warm; engine 0.5 ms; window 0.28 s)_ Performance: cold start < 2 s to interactive; pack parse < 300 ms; virtualise long lists.
- [x] **P9-T4** _(1280×720 + 1920×1080, day + night checked; 125/150 % Windows scaling still to be eyeballed by the owner)_ Visual QA at 1280×720 and 1920×1080, at 100/125/150 % scaling; both themes.
- [x] **P9-T5** Copy pass: plain words, no jargon without a tooltip, consistent terms (spot / map / monster).

### Phase 10 — Packaging, QA, release

- [x] **P10-T1** _(v1.0.0, original icon, exe at project root)_ (Location rule, the owner 2026-10-05: the final exe lives at the project root `<project folder>\MapleClassicCompanion.exe`, built with `npm run exe`; git-ignored.) App icon, version `1.0.0`, exe file properties, final name per G-5.
- [ ] **P10-T2** Full QA checklist on the built exe (every row of §4 demonstrated; results in §14).
- [x] **P10-T3** Docs: `README.md` (for players: download, run, where data lives, how to back up), `docs/DATA_MAINTENANCE.md` (Appendix C expanded), `docs/RELEASE.md`, `docs/SOURCES.md`.
- [ ] **P10-T4** Release (built locally, not in CI): `npm run build:exe` → `scripts/release.ts` computes sha256, signs the exe, writes `releases/latest.json` + `.sig` → commit, tag `v1.0.0`, push → create the GitHub Release and upload `MapleClassicCompanion.exe` (with `gh release create v1.0.0 <exe>` after `winget install GitHub.cli` and `gh auth login` by the owner, or by the owner dragging the file into the Releases page). The Pages publish workflow then serves the new `latest.json`. **Verify:** an older build shows "Version 1.0.0 is ready" and updates itself.
- [ ] **P10-T5** Clean-machine check: run the downloaded exe under a second Windows user account (Windows Sandbox is not available on Windows Home) — first run, wizard, data update, restart.

### Phase 11 — Approved ideas only

Build only §13 rows marked `APPROVED`, each as its own mini-plan (tasks, verify) appended below this line.

---

## 11. Test strategy

| Layer | Tool | What it proves |
|---|---|---|
| Rust unit | `cargo test` | paths, atomic save, recovery, pack install, signature |
| TS unit | Vitest | schemas, engine, time, news port, update client |
| Component | React Testing Library | each screen's default (collapsed) state and key interactions |
| End-to-end | Playwright (browser + IPC mock) | wizard → recommendation → backup; quest completion; character switching |
| Data | `datapack:validate` + coverage report | accuracy rules §6, integrity §8.5 |
| Packaged smoke | manual checklists in `tests/manual/` | portable run, paste, YouTube, updates, failure drills |

Commands: `npm test` · `npm run typecheck` · `npm run lint` · `cargo test --manifest-path src-tauri/Cargo.toml` · `npm run datapack:validate` · `npm run e2e` · `npm run build:exe`. All must pass before any phase is marked DONE.

---

## 12. Risks

| ID | Risk | Mitigation |
|---|---|---|
| R-1 | **Biggest risk.** MeowDB is link-only, so built-in game data starts thin and grows with the owner's field notes and approved sources. | Engine works on sparse data (level-band mode, honest empty states); exact deep links to MeowDB for detail; field-notes workflow (§6.5); source survey (P3-T0); "what to note next" list after each batch; coverage report. Never pad with legacy numbers. |
| R-2 | `&` in the project path breaks npm bin shims — **confirmed 2026-10-05**. | P0-T3: rename the folder (preferred) or work from a junction (tested OK for npm; if cargo/tauri misbehave from the junction, rename). |
| R-12 | GitHub pauses scheduled workflows after 60 days of repo inactivity; Pages caches ~10 min. | App-side checks are the guarantee (P7-T7, P8-T4); re-enable workflows from the Actions tab if paused. |
| R-13 | Public repo: something private gets pushed by mistake. | `.gitignore` covers data folder, field notes, keys; P8-T1 pre-push check; signing key only as an Actions secret. |
| R-3 | YouTube embeds blocked inside WebView2 (Error 153 / referrer). | P1-T6 spike; fallback thumbnail + open in browser. |
| R-4 | Game is brand new (Founder's Access starts 7 Oct, Sydney time); data shifts at launch and with patches. | Staleness banner (P7-T7), news-watch issue (P8-T5), maintenance runbook, confidence chips. |
| R-5 | Nexon changes or closes the public CMS feed. | Astra's validation guards; show last good news with a clear "couldn't refresh" state. |
| R-6 | Nexon IP (sprites, names). | D-11, G-4, hotlink/attribute, non-commercial, no bundled rips. |
| R-7 | Unsigned exe triggers SmartScreen on friends' PCs. | G-7; document "More info → Run anyway"; signing if going public. |
| R-8 | WebView2 missing on a target PC. | P1-T3 startup check with download link. |
| R-9 | Portable folder on a slow/removable drive; write failures. | Atomic writes, backups, read-only fallback, visible error toast. |
| R-10 | A bad datapack ships. | Signature, schema validation before swap, automatic rollback, bundled baseline. |
| R-11 | Formula uncertainty makes EXP/hour estimates wrong. | Estimates only when the user supplies their damage range; shown as ranges; unverified formulas disabled by flag; idea I-02 calibrates from real sessions. |

---

### 12.1 Privacy & legal audit — 2026-10-06 (owner asked: "no gaps, no repercussions")

**What was checked (all verified by command, not by reading):**

| Area | Check | Result |
|---|---|---|
| Public repo content + full history | `git grep` over every revision reachable from `origin/main` for name, surname, email, `C:\Users\…` | Nothing. Only author on GitHub: `ViciousTaco <ViciousTaco@users.noreply.github.com>` |
| Local-only leftovers | Branch `local-history` (pre-cleanup commits with the owner's name/path) | Never pushed; **deleted and purged** (`reflog expire` + `gc --prune=now`). `.claude/launch.json` (local node path) is git-ignored and never pushed |
| Future commits | Repo-local `user.name` / `user.email` | `ViciousTaco` / noreply address |
| Folder path in public files | The project folder's full Windows path appeared in MASTER_PLAN.md and two script comments | Scrubbed to "the project folder" / `<project folder>` |
| Published exe (GitHub Release v1.1.0) | `grep -a` for name/email/user path | None. The compiler had embedded the *project folder* path (467×, harmless — no username); `dev-env.ps1` now sets `--remap-path-prefix`, so future exes carry no local paths |
| What the app sends out | User-Agent strings to Nexon CMS and the wiki | `MapleClassicCompanion/<version> (personal news reader)` — no contact details |
| Secrets & private data | `.keys/`, `MapleClassicCompanion-data/`, `field-notes/`, `test-run/`, `.tmp/`, `.cache/`, the exe | All git-ignored; never in any commit (`git log --all -- <path>` empty; no key material in history) |
| Game artwork | Bundled or published images | None. Data holds wiki image *URLs* only; pictures are fetched to the owner's PC for personal use. App icon is an original generic leaf |
| Wiki data licence (CC BY-NC-SA 4.0) | Attribution per record, licence URL, "changes made", non-commercial, share-alike | Compliant; `datapack/NOTICE.md` now **ships with the published data** (`dist-datapack/NOTICE.md`) as well as in the repo |
| Code licence | Repo had no LICENSE | **MIT added** (holder "ViciousTaco", 2026) with a footer separating the CC data and Nexon's content; recorded in `package.json`, `Cargo.toml`, README |
| Third-party code & fonts | Tauri/React/etc. (MIT/Apache/ISC), Bricolage Grotesque + Figtree (SIL OFL) | Permitted use; OFL texts ship in `node_modules/@fontsource-variable/*/LICENSE` |
| Nexon news, MeowDB, YouTube | Live public feed with link-back; link-only; standard embed | As designed (D-1, G-1) |

**Residual risks the owner accepted (none removable by code):**

| ID | Risk | Mitigation / position |
|---|---|---|
| R-14 | **Nexon's third-party-program terms** are broad. The screen watcher is passive (on-screen pixel copy + offline OCR; no injection, memory, input, hooks or overlay — the same mechanism as Discord/OBS screen sharing), but no one can guarantee Nexon's policy or detection. | Off at every launch; owner-only on-switch; documented plainly on the Watch screen, README and D-10. Not using the watcher removes this exposure entirely; nothing else in the app touches it. |
| R-15 | Commit timestamps carry `+11:00` (Sydney). | Already implicit: the app is openly built for Sydney time. Acceptable to the owner. |
| R-16 | Pseudonymous copyright holder ("ViciousTaco"). | Valid; only matters if the owner ever wanted to enforce the licence (would require proving identity). |
| R-17 | Exe is not Authenticode-signed (only minisign for updates) → SmartScreen warning for other downloaders. | Cosmetic for a personal tool; a code-signing certificate is a paid step if the audience grows. |
| R-18 | Update signing key (`.keys/`, GitHub secret `MCC_SIGNING_KEY`) — compromise would let someone ship a malicious "update". | Key lives only on this PC + as a GitHub secret; back it up privately; rotate (new key, new exe, new baseline) if the PC is ever compromised. |

**Standing rules (keep):** never push `local-history`-style branches; keep the repo-local git identity; scan with the §12.1 commands before any history rewrite or new public artefact; `datapack/NOTICE.md` must stay in the build; no personal, file or path details in release notes, screenshots or docs.

## 13. Ideas backlog — nothing here is built until the owner marks it APPROVED

Any model may add `PROPOSED` rows. Only the owner changes Status. ★ = recommended by the planner.

| ID | Idea | Benefit | Size | Status |
|---|---|---|---|---|
| I-01 ★ | **Personal drop log**: tap to log kills and drops per spot; shows your observed rate with sample size. | The only honest way to get real drop rates while none are published. | M | PROPOSED |
| I-02 ★ | **Session tracker**: start/stop timer + EXP % before/after → real EXP/hour, used to calibrate estimates for that character. | Recommendations get more accurate the more you play. | M | PROPOSED |
| I-03 ★ | **Mini mode**: small always-on-top window with the current spot, backup button and quest steps (a plain window; no game interaction). | Usable while playing on one monitor. | S | PROPOSED |
| I-04 ★ | **Global search (Ctrl+K)** across monsters, items, maps, quests, NPCs. | Fastest navigation. | S | APPROVED 2026-10-06 |
| I-05 ★ | **Event reminders**: Windows notifications before GM events and deadlines, in Sydney time. | Don't miss timed rewards. | M | PROPOSED |
| I-06 | **Skill build planner** with SP budget check and recommended orders (sourced). | Avoids irreversible skill mistakes. | M | PROPOSED |
| I-07 | **Meso goal planner**: target amount → hours at the best meso spot. | Makes the meso path concrete. | S | PROPOSED |
| I-08 | **Party quest helper** for "First Time Together" (stage guide, requirements). | Smooth first PQ runs. | S | PROPOSED |
| I-09 | **Boss tracker** for the 5 bosses: where, recommended level, your own kill timers. | Loot and EXP planning. | M | PROPOSED |
| I-10 | **Crafting & Citizenship planners** (6 professions; Henesys vs Kerning perks). | Covers Classic World's new systems. | L | PROPOSED |
| I-11 ★ | **Scheduled patch-watch agent**: an AI routine that reads new Nexon patch notes and drafts a datapack update for the owner to approve. | Keeps guide data current with little effort. | M | PROPOSED |
| I-12 | **Character share card**: export a PNG of the character card. | Fun, shareable. | S | PROPOSED |
| I-13 | **Stat-window OCR**: paste a stat-window screenshot to auto-fill level and stats (local Windows OCR). | Less typing. | L | PROPOSED |
| I-14 | **Spanish UI** (the game supports Spanish beta). | Wider audience if public. | M | PROPOSED |
| I-15 | **Sound effects** (toggle) for level-up and updates. | Charm. | S | PROPOSED |
| I-16 ★ | **"Report / contribute" button** on every fact → pre-filled GitHub issue (or local notes file if no GitHub). | Crowd-checks accuracy; fills gaps under R-1. | S | PROPOSED |
| I-17 | **Compare two spots side by side.** | Clearer choices. | S | PROPOSED |
| I-18 | **Multi-character overview**: who needs what; shared wishlist. | Helps with 3-character accounts. | S | PROPOSED |
| I-20 ★ | **Projections**: interactive graphs — time to next level (from the character's measured EXP pace or the engine estimate), meso accumulated per hour, and drop chance over kills (`1-(1-p)^n`, only from exact/sampled rates or a clearly labelled what-if rate; never from tier heuristics, §6.3). | Makes estimates tangible and easy to read. | M | APPROVED (the owner request) 2026-10-05 |
| I-29 ★ | **Screen watcher** (replaces I-21/I-22, owner idea): owner drags boxes over the game's EXP bar and chat log; while switched on (button, top-bar pill, global hotkey Ctrl+Alt+W), Windows offline OCR reads level/EXP %/meso and pickup/EXP messages every few seconds → real EXP/h, meso/h per spot, kill counts (monster identified by EXP amount) and the owner's own sampled drop rates. Off at launch; frames never stored or sent. | Real numbers with no manual logging. | L | APPROVED 2026-10-06 (continuous, full owner control) — BUILT 2026-10-06: off at every launch; on/off only by the owner (top-bar Watch pill, big switch on the Watch screen, Ctrl+Alt+W); it may switch itself *off* (game gone 5 min, no kill 20 min) but never on. Measured rates replace estimates after 10 min + 30 kills per spot; level/EXP % follow the game after three agreeing reads; a run of 10+ min sets the measured pace; "Forget" per spot. **Playstyle follow-up (owner, 2026-10-06):** optional third box on the minimap title so the watcher follows the player map to map (kills banked per map; maps without a guide spot get a `map:<id>` key); kills the chat can't show (mobbing faster than the box scrolls, or identical lines) are taken from the rise in the EXP total, confirmed by the next read so a misread digit can't invent kills; only lines that *start* with "You have gained" count (other players' chat never does); the status bar's character name is checked against the profile and three mismatches pause watching. **Live stats (owner, 2026-10-06):** while on, the whole window is read every 5 s (~100 ms on an 886×633 window; constant whole-window reads were rejected: ~200–370 ms each at 1366×768–1080p, and the fast data lives in the per-tick boxes anyway), with the confirming read on the next tick; an open Character Stats window (STR/DEX/INT/LUK, HP/MP max, damage range, accuracy, avoid) or Skills window (name + level, "MAX") updates the character once two reads agree; "Read my stats & skills now" button works while off. Weapon "Attack N" alone is never treated as damage |
| I-21 ★ | **Kill & drop logger** (extends I-01): tap counters per spot while playing; turns "rate not known" into your own sampled rates, which then power Gold/Silver/Bronze, meso/hour and drop-chance curves honestly. | Real numbers where none are published. | M | SUPERSEDED by I-29 (owner) |
| I-22 ★ | **Session tracker with auto-calibration** (I-02): start/stop + EXP % before/after per spot; the engine learns your real kills/hour and replaces the 0.8 s / 1.5 s assumptions for your character. | EXP/hour estimates become your own. | M | SUPERSEDED by I-29 (owner) |
| I-23 ★ | **Fill the data gaps from the wiki**: regular (non-job) quests with steps and rewards, NPC sub-locations (job schools etc.), Lv 55–70 monsters/spots, skills (damage %, targets) for computed estimates. | Quests screen and estimates become much richer. | L | APPROVED 2026-10-06 |
| I-24 | **Mini overlay window** (I-03): small always-on-top card with current spot, backup button, route step and quest checklist — a separate window, never touching the game. | Use while playing on one monitor. | S | APPROVED 2026-10-06 — BUILT 2026-10-06: top-bar button opens it; it never saves (read-only store, Rust refuses `profiles_save` from `mini`), sends `skip-spot` / `quest-step` / `watch-toggle` to main via `relay_to_main`, reloads on `mcc://profiles-saved` |
| I-25 | **Party finder helper**: for party spots and the PQ, show level bands and what each class brings; copyable Discord/Megaphone message. | Faster party forming. | S | APPROVED 2026-10-06 — BUILT 2026-10-06 (Train → Party up). "What each class brings" waits for verified Classic party rules |
| I-26 | **Event reminders** (I-05): Windows notifications 15 min before GM events/deadlines (Sydney time). | Never miss timed rewards. | S | APPROVED 2026-10-06 — BUILT 2026-10-06: lead time 5/15/30/60 min (default 15), deadlines also 24 h ahead, bell per event on Home/News, Settings switch; Windows toast or banner + taskbar flash fallback |
| I-27 | **Global search Ctrl+K** (I-04) across maps, monsters, items, quests, NPCs. | Fastest navigation. | S | APPROVED 2026-10-06 — BUILT 2026-10-06 (also screens; Ctrl+K) |
| I-28 | **Daily wiki change check** once the MapleClassic Wiki maintainers OK it (`docs/wiki-permission-request.md`). | Data stays current with less effort. | S | APPROVED 2026-10-06 as **on request**: the owner asks a Claude session ("check the wiki and Nexon for updates"); no API key in the app, no schedule — BUILT 2026-10-06 as the runbook in `docs/DATA_MAINTENANCE.md` → "Refreshing on request" |
| I-30 | **Calibration snapshot**: a "Save a test picture" button in the watcher setup writes one picture of the game window to `field-notes\inbox\` only when the owner clicks it; a Claude session tunes the OCR parsers to the real Classic fonts/layouts from it. | Every parser so far is tuned to a stand-in window; launch-day accuracy. | S | PROPOSED 2026-10-06 (do before first play) |
| I-31 | **Fullscreen check**: detect exclusive-fullscreen (black capture) and tell the owner to use windowed/borderless. | Otherwise the watcher silently counts nothing. | S | PROPOSED 2026-10-06 (do before first play) |
| I-32 | **Self-pacing reads**: if a read takes longer than the interval, back off automatically. | Robustness on a slow day. | S | APPROVED 2026-10-06 — BUILT 2026-10-06: loop waits max(interval, 1.5 × last read duration); `effectiveIntervalMs` shown on the Watch screen |
| I-33 | **Choose the hotkey** (default Ctrl+Alt+W). | Avoid clashes. | S | APPROVED 2026-10-06 — BUILT 2026-10-06: owner chose **Ctrl+Shift+K** as the default; HotkeyPicker (press a combination), `settings.hotkey`, `hotkey_set` |
| I-34 | **Training log**: every watching run saved (date, map, duration, kills/h, EXP/h, meso/h, pickups) with per-spot charts over time. | See whether a spot or build change paid off. | M | APPROVED 2026-10-06 — BUILT 2026-10-06: `profile.trainingLog` (cap 500; checkpoints of one stretch merged), Training log card with per-place EXP/h chart (single series, hover values) |
| I-35 | **Owner's own drop rates**: pickups per spot → "You: 3 in 240 kills" beside the guide's rate labels and into the Plan drop-chance graph (caveat: pickups, not drops). | Real numbers where none are published. | M | APPROVED 2026-10-06 — BUILT 2026-10-06: `ownDropRate` — pickups ÷ kills where the monster is the sole dropper on the map (≥ 20 kills); shown as “You: 3 in 240 kills” on Train and Loot and used by the Plan drop-chance graph when no official/sampled rate exists |
| I-36 | **Calibrate estimates from history**: fit the engine's 0.8 s attack / 1.5 s mobility constants to the owner's measured spots, so unmeasured spots match how they actually play. | Better estimates everywhere. | M | APPROVED 2026-10-06 — BUILT 2026-10-06: `calibration()` — median observed/predicted kills/h over measured spots, clamped 0.5–2, applied to unmeasured computed spots with the warning “Scaled to N% … from the K spots your screen watcher measured” |
| I-37 | **Live level-up ETA + session summary** on the Watch screen; copyable one-liner when switching off. | Motivation / sharing. | S | APPROVED 2026-10-06 — BUILT 2026-10-06: run totals survive checkpoints/map changes; “At this pace, Lv N+1 in about …”; Last-session summary line with Copy |
| I-38 | **Quest window reading**: whole-window read of the in-game Quest window → auto-tick active/done. | Same mechanism as the Stats window; no manual ticking. | M | APPROVED 2026-10-06 — BUILT 2026-10-06: `parseQuestWindow` (tab heading above a name decides In Progress / Completed); applied with the same two-read agreement; never un-completes |
| I-39 | **HP alert**: status-bar HP below an owner-set threshold → toast + taskbar flash. Passive, nothing in the game touched. | Classic benign use of screen reading. | S | PROPOSED 2026-10-06 (owner's call) |
| I-40 | **New character from a screenshot**: paste a Stats-window picture in the wizard → prefilled stats/level/job via the existing parsers. | Fast setup. | S–M | PROPOSED 2026-10-06 |
| I-41 | **Backup copy to an owner-chosen folder** (opt-in; e.g. OneDrive). | Drive failure protection. | S | PROPOSED 2026-10-06 |
| I-42 | **Real Windows notifications** via one Start Menu shortcut (AppUserModelID) — writes outside the project folder. | Toasts instead of banners. | S | PROPOSED 2026-10-06 (conflicts with rule 13 unless the owner opts in) |
| I-43 | **Authenticode code-signing certificate** (paid, ~A$300+/yr). | Removes SmartScreen warnings for other downloaders. | — | PROPOSED 2026-10-06 (only if the audience grows) |
| I-44 | **Diagnostic log** (owner, for testing on normal MapleStory): while switched on, every read's recognised text and the watcher's decisions go to `field-notes\\watch-log\\<date>.jsonl` (text only, never pictures); “Open log folder” / “Delete diagnostic logs” buttons; a Claude session assesses the log and tunes the parsers. Plus “Forget everything the watcher learned for <character>” (observations, training log, pace) so a test never mixes with Classic World. | Tune against the real game without screenshots. | S | APPROVED 2026-10-06 (owner asked) — BUILT 2026-10-06 |
| I-45 | **EXP bar fill** (owner's idea, from the normal-MapleStory test): a 4th optional box drawn tightly around the EXP bar; Rust measures how far it is filled from the pixels (median over rows, tolerant of text drawn over it) and that becomes the EXP % whenever the digits can't be read — so pace, EXP gained and time-to-level work from the bar plus the clock alone. | EXP tracking that doesn't depend on tiny digits. | S | APPROVED 2026-10-06 (owner) — BUILT 2026-10-06 |
| I-19 ★ | **Quick note (in-app field notes)**: a button on every screen (and `Ctrl+N`) opens a small box: paste/drop screenshots, paste text copied from a page the owner is reading (e.g. MeowDB), optional source URL, optional link to the current monster/map/quest. Saves to `field-notes\inbox\<stamp>\`. A pasted MeowDB URL gives the exact `ext.meowdb` id. The maintaining model converts notes per §6.5 on request. The app never fetches the URL. | Makes Tier B data entry effortless — the main data source under G-1. | S | APPROVED 2026-10-05 — built as P2-T6b |

---

## 14. Session Log (append a row every session; newest last)

| Date (Sydney) | Model | What was done | Verify results | Exact next step |
|---|---|---|---|---|
| 2026-10-05 | Claude (Fable 5.1) | Researched Astra tracker, Nexon CMS feed, MeowDB terms/robots/pages, local toolchain. Wrote this plan v1.0. No code. | n/a | The owner answers G-1…G-7 → P0-T2, P0-T3 → P1-T1 |
| 2026-10-05 | Claude (Fable 5.1) | Gates answered; the owner created the public GitHub repo. Full review → plan v1.1 (see §15). Ran the path probe and scaffold-flag check. No code; no git repo yet; project folder contains only this file. | Path probe: `npm run` with a bin shim FAILS in the `&` folder, PASSES (`1.3.0`) via a junction. `create-tauri-app` 4.7.4 accepts the P1-T1 flags. Astra cache has raw article 45621 with the expected hash. | P0-T3 (the owner renames the folder, or use a junction) → P0-T2 → P1-T1 |
| 2026-10-05 | Claude (Opus 5.5) | P0-T3 verified, P0-T2 git init + first commit, P0-T5 versions recorded, P1-T1 scaffold moved to root, renamed, `tauri.conf.json` set (1280×800, min 1024×640, bundle off). Plan review recommendations given to the owner (pending answers). | semver probe → `1.3.0`; `git log` 1 commit; `cargo build` OK (2m15s); `npm run tauri dev` opened window "Maple Classic Companion". Note: dev binary is `maple-classic-companion.exe`; `mainBinaryName` applies to release build — confirm at P1-T7. | P1-T2 tooling |
| 2026-10-05 | Claude (Opus 5.5) | Recorded the owner's decisions (§15, G-2 username ViciousTaco, I-19 Quick note → P2-T6b). P1-T2 tooling; P1-T3 `paths.rs`; P1-T4 `storage.rs` + IPC (`get_paths`, `profiles_*`, `backups_*`) + single-instance + `src/platform/` (tauri + mock); screenshots/entity image commands (raw binary IPC, final versions); CSP + opener allow-list; spike page (`src/spike/`) with paste, YouTube lite embed, data folder; `signing.rs`; self-replace demo; release exe built and copied to `Desktop\mcc-test\`. | `cargo test` 18 passed (paths 3, storage 8, screenshots 4, signing 3); `npm test` 3 passed; typecheck + lint clean; portable run OK (see §15). | The owner: test paste + YouTube in the test exe; store the signing key. Then P1-T9 → P2-T1 |
| 2026-10-05 | Claude (Opus 5.5) | Moved every file into the project folder (`dev-env.ps1`, `.cache`, `.tmp`, `.keys`, `test-run`). P1 closed (the owner: paste + YouTube PASS). Phase 2 built: profile schema + migrations, profile store (debounced save, flush on close, read-only safety), first-run wizard, Characters screen (switch/duplicate/archive/delete + 10 s undo, import), character sheet (identity, level stepper, job picker from pack, stats, combat, skills, unlocks, notes, export), screenshot paste/drop/pick + 3:4 crop, Quick note (Ctrl+N), Settings (data folder, open folders, restore backup, display, disclaimer), window size/position memory, single-instance. Fixed a level-input bug (clearing then typing gave 131 → 100). | `npm test` 50 passed; `cargo test` 24 passed; lint + typecheck clean; torture test: 10/10 kills mid-save loaded cleanly, no restore needed; browser check of every screen, no console errors. Read-only fallback drill skipped (would write outside the project folder; unit-tested). | The owner: hands-on checklist in `tests/manual/persistence.md`. Next: P3-T0 source survey + P3-T1…T4, T10 |
| 2026-10-05 | Claude (Opus 5.5) | iOS "Maple Glass" redesign (the owner) + Train design preview; exe now at project root (`npm run exe`). Phase 3 core: pack zod schemas, validator (14 rules), source reader, build + manifest + bundle, official seed (meta, jobs, unlockables, formulas, focus weights, 9 events with article hashes), pack loader with installed→bundled fallback and indexes, coverage report. P3-T0 survey by sub-agent → `docs/SOURCES.md`. | `npm test` 86 passed; typecheck (src + scripts) + lint clean; `datapack:validate` ✓; manifest hashes = Get-FileHash for 16/16 files; app loads bundled pack in browser with no notices. Coverage: 0 spots/monsters/maps — every Lv 1–50 band is a gap (needs field notes or an approved source). | The owner: approve `docs/SOURCES.md` statuses (esp. MapleClassic Wiki). Next: P4 engine, I-20 projections, P5–P10 |
| 2026-10-06 | Claude (Opus 5.5) | Phases 4–10 built with 3 parallel sub-agents (data, news port, Rust updater). Engine (§8.7) + projections (I-20); screens: Home, Train (real map pictures, backups, routes with portal positions), Plan, Loot (wishlist, tiers), Gear & stats (AP builds, derived upgrades), Quests (job cards, step checklists), News (live Nexon CMS, Sydney time), Maps browser, Settings (versions, credits); live update loop (signed datapack + app self-update), GitHub workflows, icon, v1.0.0, docs. Data: 47 monsters, 187 maps (400+ links, 323 portal positions), 27 spots, 268 items, 352 drops, 167 NPCs, 20 job quests, 4 AP builds; Forgotten Hollow parked. Audit fixes: honest meso/hour, disclosed estimate assumptions, build-aware gear, exact-job quests, Beginner build leak, load timeout. Owner identity removed from the public repo (single clean commit; local history kept in branch `local-history`). | `npm test` 260+ passed; `cargo test` 51 passed; typecheck (src+scripts) + lint clean; datapack valid; coverage: every 5-level band Lv 1–50 ≥ 2 spots per archetype; real-key signature verified, tamper rejected; exe live: Nexon news cached, wiki pictures cached, nothing written outside the project folder. | Owner: GitHub Pages source + MCC_SIGNING_KEY secret; drag the exe into the v1.0.0 GitHub Release; play and Quick-note; approve §13 ideas. |
| 2026-10-06 | Claude (Opus 5.5) | App **v1.1.0**. Built I-29 screen watcher (OCR parsers, chat dedupe, kill-by-EXP, per-spot observations → measured rates replace estimates, level/EXP % sync, auto pace; Watch screen + setup wizard + top-bar pill + Ctrl+Alt+W; auto-off only), I-26 reminders, I-24 mini window, I-25 party helper, I-27 Ctrl+K, I-28 runbook. Sub-agents: Rust (GDI screen copy + Windows.Media.Ocr, global hotkey, notification fallback, mini window + relay, mini can't save) and data (I-23: 186 quests, 37 maps, 7+55 NPCs, 135 items, 90 skills, Lv 56–70 monsters). Lead verified skill hits/targets against each wiki skill box (fixed Double Stab/Magic Claw/Lucky Seven ×2, Thunder Bolt 6 targets). Main-attack-skill picker added. Live feed confirmed signed with the app key. | typecheck/lint clean; vitest 291/291; cargo 71/71 (+3 manual); datapack valid; UI walked end-to-end in headless Edge against the mock (setup → watching → feed → Train). **Real OCR check** (self-test build, separate identifier, stand-in "MapleStory" window): 2 regions in 128 ms; 45 s live run counted 14 kills / 336 EXP vs 15 kills / 360 EXP on the bar (1 kill fell before the priming read), all 3 item pickups, level and EXP % every read. Real OCR slips found and handled: "%]" → "0/01", "m" → "rn"; identical chat lines (one monster type) recovered from the EXP total. Nothing written to AppData. Release exe 8.7 MB, signed `latest.json` staged in `.tmp/release-1.1.0/` (not committed) | Owner: create GitHub Release **v1.1.0** and attach `.tmp
| 2026-10-06 | Claude (Fable 5.1) | Owner: the watcher must suit any playstyle (moving around, mobbing, other players on screen) and know whose character it reads. Built: minimap box → follows the player map to map; EXP-total cross-check for kills the chat can't show (confirmed next read); line-start rule for gain messages; character-name check. Live OCR on the stand-in window: map name read correctly 2/3 (the miss was "III"→"Ill", now repaired), name read every time. | typecheck/lint clean; vitest 301 + 8 new (24 watcher tests); release exe rebuilt | Swap the root exe once the owner closes the app (background waiter); owner still to create GitHub Release v1.1.0 |
| 2026-10-06 | Claude (Fable 5.1) | Owner: live-update stats and skills from the in-game windows; confirm the app stays external (no editing/injection). Built whole-window reads every 10 s + on-demand button, Stats/Skills window parsers with two-read agreement; answered the ban question with the code audit (same pixel copy as Discord/Teams screen share, no overlay/hook/handle). | vitest 30 watcher tests, full suite green; live OCR whole window 89–112 ms | Swap the root exe when the owner closes the app; owner creates GitHub Release v1.1.0 |
| 2026-10-06 | Claude (Fable 5.1) | Published v1.1.0: owner created the GitHub Release; downloaded asset hash verified = signed `latest.json`; update feed live. Owner asked for a privacy/legal audit with no gaps and no repercussions → §12.1 (checks, fixes, residual risks R-14…R-18), MIT licence, `local-history` purged, NOTICE shipped with data, local paths out of docs and future builds. | All checks by command (see §12.1); scripts tests 21/21; lint clean; LICENSE live on GitHub | Nothing pending from the owner. Next build picks up path-stripping automatically |
| 2026-10-06 | Claude (Fable 5.1) | Owner asked for further improvements → I-30…I-43 proposed in §13 (launch-day watcher hardening, training log, own drop rates, estimate calibration, quest-window reading, HP alert, screenshot import, backup copy, notifications/code-signing trade-offs). Suggested order: I-30, I-31, I-32 before first play; I-34, I-35, I-37 after a few real sessions. | n/a | Owner picks; build approved rows |
| 2026-10-06 | Claude (Fable 5.1) | Owner approved I-32, I-33 (Ctrl+Shift+K), I-34…I-38 and asked for a test on normal MapleStory with a log, plus a way to erase test data. Built all of it + I-44 (diagnostic log, forget-per-character). Fixed: `dev-env.ps1` RUSTFLAGS broke on the space in the folder name → `CARGO_ENCODED_RUSTFLAGS`. UI walked in the preview (summary, training log, hotkey picker, data card). | cargo 73/73; vitest 313/313 (34 watcher); typecheck/lint clean | Owner: run the normal-MapleStory test on a throwaway character with the diagnostic log on, then ask a session to assess `field-notes\\watch-log\\*.jsonl` |
| 2026-10-06 | Claude (Fable 5.1) | Two logged runs on normal MapleStory assessed. Run 1: status bar + minimap read cleanly, chat font mangled at 2× → all boxes 3×, Smooth/Pixel-sharp text style, tagged system lines. Run 2: two stat windows open paired labels with the wrong numbers → one-column pairing + Classic plausibility guard (`plausibleStats`); EXP digits unreadable → **I-45 EXP bar fill** (Rust `mode: "bar"`); level 272 must be applied despite the cap → **D-11**. Diagnostic log proved its worth: every fix above came from it. | cargo 74/74; vitest 316/316; typecheck/lint clean | Owner: third logged run with the EXP-bar box + Stats window alone; then release 1.1.1 |
elease-1.1.0\MapleClassicCompanion.exe`; then copy `.tmp
elease-1.1.0\latest.json(.sig)` into `releases\`, commit and push (or ask a session to) |

---

## 15. Plan Change Log, version lock and spike results

| Date | Change | Approved by |
|---|---|---|
| 2026-10-05 | Plan v1.0 created | — |
| 2026-10-05 | Gates G-1…G-7 answered (see §2). P0-T1 done; P0-T4 (email) cancelled. New P9 work from G-4: paste-your-own image per record + "Find image" button. | The owner |
| 2026-10-05 | P0-T3 resolved by Option 1: folder renamed to the project folder. Toolchain (P0-T5): Node 22.23.2, npm 10.9.8, rustc/cargo 1.95.0 msvc, git 2.49.0. Repo-local git identity set to the owner. | The owner (renamed folder) |

| 2026-10-05 | Review recommendations: (1) drop `window-state` plugin, store window geometry in `profiles.json` — APPROVED; (2) image IPC uses raw binary bodies instead of `number[]` (§8.3 updated) — APPROVED; (3) defer app self-update — REJECTED, P8-T6 stays; (4) field notes made effortless → I-19 Quick note APPROVED as P2-T6b; MeowDB remains link-out only (G-1) but the owner may paste text they copied themselves into a note; (5) `recommend.ts` pre-sorts candidates by `spotId` before `pickPlan` so ties are deterministic — APPROVED. GitHub username ViciousTaco recorded (G-2). | The owner |

**Version lock (fill in at P1-T1):** tauri `2.12.1` · tailwindcss `4.3.3` · motion `14.0.0` · zustand `5.0.15` · zod `4.6.5` · vitest `5.0.3` · eslint `10.12.0` · tauri · @tauri-apps/cli `2.12.1` · @tauri-apps/api `2.12.1` · react `19.3.0` · vite `8.3.2` · typescript `6.0.3` · tailwindcss `…` · motion `…` · zustand `…` · zod `…` · vitest `…` · playwright `…`

| 2026-10-05 | **Plan v1.1 review.** Fixed: (1) `&` path hazard confirmed → P0-T3 rewritten and moved first; (2) data strategy rewritten for link-only MeowDB: field-notes workflow §6.5, source survey P3-T0, link accuracy rule; (3) pack install order corrected (validate before any disk write; signature checked before downloads; path traversal check) and `pack_verify_manifest` added; (4) engine spec completed: multi-mob weighting, level-band ranking, gated regions, skill/AoE handling, `desirability`, `all-skipped`; `Skill` type and `gatedRegions`/`aoeEfficiency` added to schemas; (5) G-4 image features specified (`entity_image_*`, Find image); (6) GitHub specifics: feed URLs, opener/http allow-lists, update URL allow-list, P8-T1 steps, release steps, 60-day workflow pause; (7) news hash-compatibility test with Astra fixtures; (8) build order, milestones, baseline bundling in the build; (9) screenshot checks made implementable (magic bytes + size in Rust, resize in UI). | The owner (asked for the review) |

| 2026-10-05 | All app, test, key, cache and temp files kept inside the project folder: `dev-env.ps1`, `.cache\`, `.tmp\`, `.keys\`, `test-run\` (git-ignored). Removed the Desktop test folder, `%USERPROFILE%\.mcc-keys` and a leftover `%LOCALAPPDATA%\com.vicioustaco.mapleclassiccompanion` from the first dev run. D-2's `%LOCALAPPDATA%` fallback is kept (it only triggers when the exe folder is read-only). | The owner |

| 2026-10-05 | Phase 2 implementation notes: (a) `migrate()` returns `{kind:'ok'|'read-only'|'invalid'}` instead of a bare `ProfilesFile` so the UI can show read-only/invalid states — an unreadable file is never overwritten; (b) `settings.window` added to the profiles schema (window geometry, applied by Rust before the window shows); (c) extra IPC: `profiles_backup_now` (before restoring a backup), `export_save` + `reveal_folder` (exports go to `<data>\exports\`, no file dialogs), `field_note_create` / `field_note_add_image` (Quick note → `<data>\field-notes\inbox\<stamp>\`); (d) `meta.jobAdvancements[].npcId` is optional — the 2nd-job instructors are not in official notes yet; (e) `datapack/unlockables.json` (regions, bosses, party quest, crafting, citizenship — all official) added for the G-6 unlock checklists; (f) character images render as `data:` URLs; (g) `sydney.ts` `zonedParts` + full §8.8 table done early (P7-T3 still owes `parseExplicitTimes`). | Claude (within approved scope) |

| 2026-10-05 | Phase 3 notes: validator rule **14** added (focus weight rows sum to 1); `meta.jobAdvancements[].npcId` omitted until NPC records exist (instructor names are in `jobs.json`); built pack = 16 flat files (`PACK_FILES` in `src/data/schema/pack.ts`) incl. `unlockables.json`; GM events modelled as 4 separate `gm-event` records with exact UTC windows from article 45621; one-off moments/deadlines use `startUtc` with `endUtc: null`; `npm run dev`/`build` run `datapack:bundle` first (baseline at `public/baseline/`, git-ignored). The app never reads the Astra folder — hashes were copied once into `datapack/events.json`. | Claude (within approved scope) |
| 2026-10-05 | Visual direction changed to iOS-style "Maple Glass" (§9.5). Final exe location: project root via `npm run exe` (`scripts/copy-exe.mjs`). P5-T1's kit restyle done early; G-5 mock = Train design preview. | The owner |

| 2026-10-05 | The owner approved: P3-T0 statuses (MapleClassic Wiki approved), G-5 design, P8 push, and I-20 Projections. Schema: `maps[].spawns[].count` and `trainingSpots[].popularity` made optional (fan sources don't publish them; never guessed). | The owner |

| 2026-10-06 | Engine notes (§8.7): spawn counts may be unknown → equal mob weights; safety/convenience are absolute 0–1 (only exp/meso/drop/equip normalised); party-only spots returned as `partySpots`; ties pre-sorted by spotId; job-category quests need the exact job. | owner |
| 2026-10-06 | Shown meso/hour uses only known meso ranges + official/sampled drop rates (ranking may still use tier heuristics, never displayed — §6.3); computed estimates carry an `estimate-assumptions` warning (0.8 s/attack, 1.5 s walking). | owner |
| 2026-10-06 | Datapack additions: `ap-builds.json` (stat-point builds, rule 15), `news-rules.json`, `items[].reqStats`, `maps[].links[].pos` (portal position on the wiki map picture), `meta.gameLabelUntilUtc` ("Founder's Access" label hides at Grand Launch), `defaultRespawnSec` 7.5 (wiki); Forgotten Hollow parked in `datapack/_parked/`. | owner |
| 2026-10-06 | Pictures (G-4, owner request): wiki image URLs stored in the datapack (no images in the repo); app downloads once into `<data>\cache\images\` (personal use, credited "via MapleClassic Wiki · © Nexon"); owner's own picture always wins; Find image opens a Google image search. | owner |
| 2026-10-06 | Owner requests 2026-10-06: every progress bar shows its %; Gold/Silver/Bronze drop tiers (NPC sell price percentile + rarity; player-market prices not tracked) and "Needed for <quest>" chips; instant backup switching; "Rare Item" label; routes describe where each portal is and mark it on the map picture; readable dropdowns in both themes. | owner |
| 2026-10-06 | Publishing: repo pushed as one clean commit by ViciousTaco <noreply>; personal name, email and Windows user path removed from public files; app identifier now `com.vicioustaco.mapleclassiccompanion`; `.claude/` local-only. | owner |

| 2026-10-06 | Item pages fetched politely (212, approved source): 251/268 items now have NPC sell prices, 120 equips have stat requirements; Gold/Silver/Bronze thresholds are the guide's own price percentiles (currently ≥ 7,500 / ≥ 3,000 / ≥ 900 meso). Validator rule 3 allows one day of timezone lead (dates are written in Sydney time). Guide data 2026.10.06-1 bundled in exe v1.0.0; `releases/latest.json` signed and verified. | owner |

| 2026-10-06 | Owner approved I-23…I-28 and the new I-29 screen watcher (continuous, owner-controlled; D-10 amended as recorded in §3). I-21/I-22 superseded by I-29. I-28 = on-request data refresh via a Claude session (owner prefers this over an API key in the app). | owner |
| 2026-10-06 | Profile schema: `observations` (per-spot watcher totals) and settings `reminders` + `watch` (setup only — deliberately no "on" flag). `Estimate.basis` gains `"observed"`. Platform gains screen/hotkey/notify/mini/relay/onEvent (§8.3). Skill hits/targets: the wiki skill box, or the in-game description on the same page when they disagree (NOTICE.md). Startup "last screen" restore keeps a `?query` when already on that screen. App version 1.1.0. | Claude (within approved scope) |
| 2026-10-06 | I-29 playstyle: `settings.watch.map` (optional minimap box), `WatchState.mapId`/`autoMap`/`followMap()`, `StatusRead.name`, `parseMapName`, observation keys may be `map:<mapId>` (engine falls back to it per spot map). Real-OCR findings: "III" → "Ill" (repaired for trailing roman numerals), the setup picture includes the title bar so boxes are drawn in capture coordinates. | Claude (within approved scope) |
| 2026-10-06 | I-29 live stats: `src/features/watch/windows.ts` (parsers for the in-game Stats / Skills windows, row-paired labels and values), `WatchState.lastScan`, `scanNow()`, `FULL_SCAN_EVERY_MS` = 10 s. D-10 restated for the owner: capture is the same on-screen pixel copy Discord/Teams screen sharing uses; no overlay, hook, handle, input or file access — the audit of `screen.rs` imports is the check. | Claude (within approved scope) |
| 2026-10-06 | Privacy & legal audit (§12.1): MIT `LICENSE` added; `NOTICE.md` copied into the built datapack; folder path scrubbed from public files; `--remap-path-prefix` via `dev-env.ps1`; `local-history` branch deleted and purged; risks R-14…R-18 recorded. | owner (asked for the audit, chose MIT) |
| 2026-10-06 | `settings.watch.expBar` + `textStyle` (`smooth`/`pixel`); `Region.mode` (`ocr`/`bar`) and `RegionText.fill` in Rust/TS; `plausibleStats`; `WatchState.mapText`; level sync accepts 1–300 (D-11); steppers clamp to `max(levelCap, level)`. | owner (D-11, I-45) / Claude |

**Spike results (fill in at P1-T9):** path probe `FAIL in "&" folder; PASS via junction (2026-10-05)`; folder renamed · paste `PASS (the owner, built exe; persists after restart)` · YouTube `PASS (the owner: plays with sound, no Error 153, Open on YouTube works)` · exe size `4.6` MB · cold start `0.28 s to window` · portable `data folder + webview\ beside exe; nothing written to %LOCALAPPDATA% / %APPDATA%` · signature `PASS (tauri signer sig accepted; 1-byte change rejected)` · self-replace `PASS (v1 → v2 swap + relaunch, examples/self_replace_demo.rs)`

**Implementation notes (2026-10-05):** the main window is created in Rust `setup` with `.data_directory(<data>\webview)` (plan P1-T3's sanctioned fallback, used up front) and `WEBVIEW2_USER_DATA_FOLDER` is also set; `tauri.conf.json` has no windows. `profiles_load` returns an extra additive field `corruptFile: string | null` so the UI can say a corrupt file was kept. Backups: a session's backup is taken on the first save that has a previous file to copy (a brand-new user's 2nd save), not skipped for the whole session. Update-signing keypair (no password) at `.keys\mcc-signing.key` (moved into the project folder on the owner's request; git-ignored) — **The owner: copy it into your password manager**; public key committed at `src-tauri/keys/mcc-update.pub`. Test-only keypair's public key + signed fixture at `src-tauri/tests/fixtures/`. zod resolved to v4 → use `.prefault({})` / `z.iso.datetime()` per §8.4 note.

---

## Appendix A — Draft permission email to NiaMeowDB — NOT IN USE

the owner chose link-out only on 2026-10-05, so this email is not being sent. It is kept in case the owner later wants richer built-in data; sending it would be a new decision recorded in §2.

> **To:** contact@meowdb.com
> **Subject:** Permission request — personal MapleStory Classic World companion app
>
> Hi Meow, Sunny and Nia,
>
> I'm building a free, non-commercial desktop companion app for MapleStory Classic World that suggests training spots and quests based on a player's level and job. Your database is the best reference I've found, and I've read your Terms, so I'm asking before doing anything automated.
>
> Would you be open to any of the following?
> 1. Deep links from my app to your monster, map, item and quest pages (I plan to do this regardless, with credit).
> 2. Using factual data from your pages (for example monster level/HP/EXP, spawn maps, quest requirements) in my app's dataset, with visible attribution and a link back on every record.
> 3. If you have a preferred way to access data (an export, an API, rate limits), I'd happily follow it.
>
> I won't copy your written guides, sprites, design or code, and I'll remove anything on request. Happy to share the app and credit NiaMeowDB prominently.
>
> Thanks for the great site,
> the owner

The rule in §6.1 Tier C1 stands regardless: link out only.

---

## Appendix B — What is reused from Astra (`<parent folder>\Maplestory Events & Updates\app`)

| Astra file | Reuse | Lands in |
|---|---|---|
| `core.mjs` — `API`, `CLASSIC`, `plainText`, `classify`, `matchReason`, `validateItem`, `getJSON` (ETag, pacing, retries), `normalize`, `dateReferences`, safety guards in `collect` | Port to TypeScript; replace Node `fs`/`crypto` with IPC cache + Web Crypto `subtle.digest` | `src/features/news/` (P7-T1, T2) |
| `timing.mjs` — `sydneyParts`, `sydneyText`, `parseExplicitTimes`, `convertedReferences` | Port as-is | `src/lib/sydney.ts` (P7-T3) |
| `relevance.mjs` + `relevance-rules.json` | Port logic; ship rules in the datapack | `src/features/news/relevance.ts`, `datapack/news-rules.json` (P7-T4) |
| `test.mjs`, `timing.test.mjs` | Port cases to Vitest | alongside the ports |
| `data/current.json` (32 Classic articles, generated 5 Oct 2026) | Fixture for tests and the source of `articleHash` values for seed events | `tests/fixtures/` |
| `workbook.mjs`, `server.mjs`, `ui.js`, Excel output | Not reused (the new app replaces the workbook UI) | — |

The Astra folder is read-only reference. Do not modify it.

---

## Appendix C — Maintenance runbook outline ("Nexon posted a patch")

1. The news-watch issue (or the in-app staleness banner) names the article.
2. Read the article; list every changed fact (levels, new areas, events, drop or EXP changes, new jobs).
3. Edit the affected `datapack/` files; add the article as an `official` source; set `verifiedAt`.
4. Add or retire `events.json` entries with exact UTC windows and the article's content hash.
5. Bump `meta.reviewedThroughArticleId` and `packVersion`.
6. `npm run datapack:validate` → `npm run datapack:build` → coverage report.
7. Open a PR; CI validates; the owner approves; merge publishes. Apps pick it up on next launch or within 30 minutes.
8. If a fact can't be confirmed, lower its `confidence` rather than guess.
