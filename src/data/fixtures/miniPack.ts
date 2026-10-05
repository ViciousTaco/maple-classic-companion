import jobs from "../../../datapack/jobs.json";
import unlockables from "../../../datapack/unlockables.json";
import focusProfiles from "../../../datapack/focus-profiles.json";
import formulas from "../../../datapack/formulas.json";
import newsRules from "../../../datapack/news-rules.json";
import type { PackData } from "../schema/pack";

// Smallest valid pack, with obviously synthetic names so nobody mistakes it for game data.
const src = (kind: "official" | "in-game" | "community" | "legacy" = "in-game") => ({
  kind,
  label: `Test source (${kind})`,
  retrievedAt: "2026-10-05",
});
export const prov = (confidence: "verified" | "likely" | "unverified" = "verified", kind: Parameters<typeof src>[0] = "in-game") => ({
  sources: [src(kind)],
  confidence,
  verifiedAt: "2026-10-05",
});

export function miniPack(): PackData {
  return structuredClone({
    meta: {
      packVersion: "2026.10.05-1",
      gameLabel: "Test",
      levelCap: 100,
      charactersPerAccount: 3,
      jobAdvancements: [{ level: 10, from: "beginner", to: ["thief"] }],
      regionsAvailable: ["region-a", "region-b"],
      gatedRegions: ["region-b"],
      defaultRespawnSec: 8,
      reviewedThroughArticleId: 1,
      reviewedAt: "2026-10-05",
      ...prov(),
    },
    formulas,
    focusProfiles,
    jobs,
    unlockables,
    events: [
      {
        id: "test-event",
        title: "Test Event",
        kind: "event",
        windows: [{ startUtc: "2026-10-06T00:00:00Z", endUtc: "2026-10-07T00:00:00Z" }],
        howTo: "x",
        rewards: "y",
        articleId: 1,
        articleHash: "a".repeat(64),
        ...prov("verified", "official"),
      },
    ],
    videos: [
      { id: "AAAAAAAAAAA", title: "Test video", channel: "Test", lang: "en", topics: [{ kind: "spot", refId: "spot-a" }], appliesTo: "Test", addedAt: "2026-10-05", lastCheckedAt: "2026-10-05", status: "ok" },
    ],
    gearProgression: [{ id: "gear-a", family: "thief", slot: "weapon", itemId: "item-a", level: 10, how: ["drop"], ...prov() }],
    skills: [{ id: "skill-a", name: "Test Skill A", jobId: "thief", maxLevel: 20, kind: "attack", levels: [{ level: 1, damagePct: 120 }], ...prov() }],
    items: [
      { id: "item-a", name: "Test Item A", category: "equip", reqLevel: 10, reqJobs: ["thief"], tags: [], ...prov() },
      { id: "item-b", name: "Test Item B", category: "etc", tags: [], npcSellMeso: 5, ...prov() },
    ],
    maps: [
      { id: "town-a", name: "Test Town A", region: "region-a", isTown: true, spawns: [], links: [{ to: "field-a", kind: "portal" }], npcIds: ["npc-a"], ...prov() },
      {
        id: "field-a",
        name: "Test Field A",
        region: "region-a",
        isTown: false,
        spawns: [{ mobId: "mob-a", count: 10 }],
        links: [{ to: "town-a", kind: "portal" }, { to: "field-b", kind: "portal" }],
        npcIds: [],
        ext: { meowdb: "100000001" },
        ...prov(),
      },
      { id: "field-b", name: "Test Field B", region: "region-b", isTown: false, spawns: [{ mobId: "mob-b", count: 6 }], links: [{ to: "field-a", kind: "portal" }], npcIds: [], ...prov() },
    ],
    monsters: [
      { id: "mob-a", name: "Test Mob A", level: 10, hp: 100, exp: 10, boss: false, ...prov() },
      { id: "mob-b", name: "Test Mob B", level: 20, hp: 300, exp: 30, boss: false, ...prov("likely", "community") },
    ],
    drops: [{ mobId: "mob-a", itemId: "item-a", status: "confirmed", rate: { kind: "unknown" }, ...prov() }],
    npcs: [{ id: "npc-a", name: "Test NPC A", mapId: "town-a", ...prov() }],
    quests: [
      {
        id: "quest-a",
        name: "Test Quest A",
        category: "regular",
        minLevel: 5,
        prereqQuestIds: [],
        startNpcId: "npc-a",
        steps: [{ text: "Hunt", kind: "kill", mobId: "mob-a", mapId: "field-a", qty: 5 }],
        rewards: { exp: 50, items: [{ itemId: "item-b", qty: 1 }] },
        ...prov(),
      },
    ],
    apBuilds: [
      {
        id: "build-a",
        name: "Test Build",
        jobs: ["thief"],
        summary: "x",
        phases: [
          { fromLevel: 10, toLevel: 29, primary: "luk", targets: { dex: { base: 25 } }, text: "x" },
          { fromLevel: 30, primary: "luk", text: "y" },
        ],
        ...prov("likely", "community"),
      },
    ],
    newsRules,
    trainingSpots: [
      {
        id: "spot-a",
        mapId: "field-a",
        mobIds: ["mob-a"],
        bands: [{ archetype: "any", min: 8, max: 15 }],
        party: "solo",
        popularity: 3,
        notes: "",
        tags: [],
        videoIds: ["AAAAAAAAAAA"],
        ...prov(),
      },
    ],
  }) as PackData;
}
