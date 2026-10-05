import jobs from "../../datapack/jobs.json";
import unlockables from "../../datapack/unlockables.json";
import focusProfiles from "../../datapack/focus-profiles.json";
import formulas from "../../datapack/formulas.json";
import newsRules from "../../datapack/news-rules.json";
import { buildIndexes, type Pack } from "../../src/data/pack";
import type { PackData } from "../../src/data/schema/pack";
import { ProfileSchema, type Profile, type ProfileInput } from "../../src/data/schema/profile";

// Synthetic engine fixture (plan P4): names like "Test Mob …" so nobody mistakes these numbers for game facts.
// Designed winners at Lv 25 Thief, level-band basis: exp → spot-exp, meso → spot-meso, rare-drop → spot-drop,
// class-equip → spot-equip, balanced → spot-mix.

const prov = { sources: [{ kind: "in-game" as const, label: "Fixture", retrievedAt: "2026-10-05" }], confidence: "verified" as const, verifiedAt: "2026-10-05" };

const mob = (id: string, level: number, hp: number, exp: number, extra: object = {}) => ({ id, name: `Test Mob ${id}`, level, hp, exp, boss: false, ...extra, ...prov });
const item = (id: string, category: "equip" | "use" | "etc", extra: object = {}) => ({ id, name: `Test Item ${id}`, category, tags: [], ...extra, ...prov });
const drop = (mobId: string, itemId: string, rate: object, extra: object = {}) => ({ mobId, itemId, status: "confirmed", rate, ...prov, ...extra });
const field = (id: string, spawns: [string, number][], links: string[], region = "isle") => ({
  id,
  name: `Test Map ${id}`,
  region,
  isTown: false,
  spawns: spawns.map(([mobId, count]) => ({ mobId, count })),
  links: links.map((to) => ({ to, kind: "portal" })),
  npcIds: [],
  ...prov,
});
const spot = (id: string, mapId: string, mobIds: string[], bands: object[], extra: object = {}) => ({
  id,
  mapId,
  mobIds,
  bands,
  party: "solo",
  notes: "",
  tags: [],
  videoIds: [],
  ...extra,
  ...prov,
});
const any = (min: number, max: number) => ({ archetype: "any", min, max });

export function smallPackData(): PackData {
  return structuredClone({
    meta: {
      packVersion: "2026.10.05-1",
      gameLabel: "Fixture",
      levelCap: 100,
      charactersPerAccount: 3,
      jobAdvancements: [],
      regionsAvailable: ["isle", "gated-isle"],
      gatedRegions: ["gated-isle"],
      defaultRespawnSec: 8,
      reviewedThroughArticleId: 1,
      reviewedAt: "2026-10-05",
      ...prov,
    },
    formulas,
    focusProfiles,
    jobs,
    unlockables,
    events: [],
    videos: [],
    gearProgression: [
      { id: "g-claw", family: "thief", slot: "weapon", itemId: "i-claw", level: 30, how: ["drop"], ...prov },
      { id: "g-old", family: "thief", slot: "weapon", itemId: "i-old", level: 15, how: ["shop"], ...prov },
      { id: "g-hat", family: "any", slot: "hat", itemId: "i-hat", level: 28, how: ["drop", "craft"], ...prov },
      { id: "g-sword", family: "warrior", slot: "weapon", itemId: "i-sword", level: 30, how: ["drop"], ...prov },
    ],
    skills: [
      { id: "sk-multi", name: "Test Multi Skill", jobId: "thief", maxLevel: 20, kind: "attack", levels: [{ level: 1, damagePct: 200, targets: 3 }], ...prov },
    ],
    items: [
      item("i-very-rare", "etc", { rarity: "very-rare" }),
      item("i-rare", "etc", { rarity: "rare" }),
      item("i-claw", "equip", { reqLevel: 30, reqJobs: ["thief"], slot: "weapon" }),
      item("i-sword", "equip", { reqLevel: 30, reqJobs: ["warrior"], slot: "weapon" }),
      item("i-old", "equip", { reqLevel: 15, reqJobs: ["thief"], slot: "weapon" }),
      item("i-hat", "equip", { reqLevel: 28, slot: "hat" }),
      item("i-sell", "etc", { npcSellMeso: 200 }),
      item("i-cap", "etc"),
      item("i-potion", "use"),
      item("i-legacy", "etc", { rarity: "rare" }),
      item("i-wish", "etc"),
      item("i-shoe", "equip", { reqLevel: 60, slot: "shoes" }),
    ],
    maps: [
      { ...field("town", [], ["f-exp", "f-meso", "f-mix", "f-party", "f-gated", "f-low"]), isTown: true },
      field("f-exp", [["m-fast", 12]], ["town", "f-drop"]),
      field("f-meso", [["m-rich", 6]], ["town", "f-equip"]),
      field("f-drop", [["m-rare", 6]], ["f-exp", "f-danger"]),
      field("f-equip", [["m-gear", 6]], ["f-meso"]),
      field("f-danger", [["m-danger", 6]], ["f-drop"]),
      field("f-mix", [["m-mix", 8]], ["town"]),
      field("f-party", [["m-party", 6]], ["town"]),
      field("f-gated", [["m-gate", 6]], ["town"], "gated-isle"),
      field("f-low", [["m-low", 8]], ["town"]),
    ],
    monsters: [
      mob("m-fast", 24, 80, 24),
      mob("m-rich", 25, 150, 18, { mesoMin: 60, mesoMax: 100 }),
      mob("m-rare", 25, 150, 18),
      mob("m-gear", 26, 150, 18),
      mob("m-danger", 27, 200, 40, { touchDmgMax: 300 }),
      mob("m-mix", 25, 120, 30, { mesoMin: 40, mesoMax: 60 }),
      mob("m-party", 30, 1000, 200),
      mob("m-gate", 25, 100, 30),
      mob("m-low", 12, 40, 6),
      mob("m-spare", 40, 2000, 90),
    ],
    drops: [
      drop("m-fast", "i-cap", { kind: "unknown" }),
      drop("m-fast", "i-legacy", { kind: "tier", tier: "common" }, { status: "legacy-unverified", sources: [{ kind: "legacy", label: "Old guide", retrievedAt: "2026-10-05" }], confidence: "unverified" }),
      drop("m-rich", "i-sell", { kind: "tier", tier: "common" }),
      drop("m-rare", "i-very-rare", { kind: "tier", tier: "rare" }),
      drop("m-gear", "i-claw", { kind: "tier", tier: "uncommon" }),
      drop("m-gear", "i-sword", { kind: "tier", tier: "uncommon" }),
      drop("m-mix", "i-rare", { kind: "tier", tier: "very-rare" }),
      drop("m-mix", "i-hat", { kind: "unknown" }),
      drop("m-low", "i-old", { kind: "unknown" }),
      drop("m-danger", "i-wish", { kind: "sampled", drops: 3, kills: 1240 }),
    ],
    npcs: [],
    quests: [],
    apBuilds: [],
    newsRules,
    trainingSpots: [
      spot("spot-exp", "f-exp", ["m-fast"], [any(20, 28)]),
      spot("spot-exp-alt", "f-exp", ["m-fast"], [any(20, 28)]),
      spot("spot-meso", "f-meso", ["m-rich"], [{ archetype: "ranged", min: 22, max: 30 }]),
      spot("spot-drop", "f-drop", ["m-rare"], [any(22, 30)]),
      spot("spot-equip", "f-equip", ["m-gear"], [any(22, 30)]),
      spot("spot-danger", "f-danger", ["m-danger"], [any(22, 30)]),
      spot("spot-mix", "f-mix", ["m-mix"], [any(22, 30)]),
      spot("spot-party", "f-party", ["m-party"], [any(25, 35)], { party: "party" }),
      spot("spot-gated", "f-gated", ["m-gate"], [any(20, 30)]),
      spot("spot-low", "f-low", ["m-low"], [any(10, 15)]),
    ],
  }) as PackData;
}

export const smallPack = (mutate?: (d: PackData) => void): Pack => {
  const d = smallPackData();
  mutate?.(d);
  return buildIndexes(d);
};

export function testProfile(over: Partial<ProfileInput> = {}): Profile {
  return ProfileSchema.parse({
    id: "0b9f8a52-6a4e-4a39-9c55-2f1d1f7f0a11",
    name: "Tester",
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    jobId: "thief",
    level: 25,
    ...over,
  });
}

export const NOW = new Date("2026-10-07T00:00:00Z");
