import { NOW, smallPack, testProfile } from "../../tests/fixtures/pack.small";
import type { PackData } from "../data/schema/pack";
import { nextUpgrades } from "./gear";
import { bestLootTargets, findDropSources } from "./loot";
import { dropChance, formatDuration, hoursToLevel, killsForChance, levelTimeline, mesoSeries, paceFromSession } from "./projection";
import { availableQuests, comingSoon, rankQuests } from "./quests";
import { rateLabel } from "./rates";
import { findRoute, nearestTown } from "./route";

// ---- P4-T8 route ----
test("route: shortest path, unreachable → null, one-way respected, hidden only when unlocked", () => {
  const pack = smallPack((d) => {
    const base = d.maps[1]!;
    d.maps.push(
      { ...base, id: "f-cave", name: "Test Cave", spawns: [], links: [{ to: "f-danger", kind: "portal", note: "one-way" }] },
      { ...base, id: "f-island", name: "Test Island", links: [], spawns: [] },
    );
    d.maps.find((m) => m.id === "f-equip")!.links.push({ to: "f-cave", kind: "hidden" });
  });
  expect(findRoute(pack, "town", "f-danger")!.map((s) => s.to)).toEqual(["f-exp", "f-drop", "f-danger"]);
  expect(findRoute(pack, "town", "f-island")).toBeNull();
  // f-cave → f-danger is one-way; nothing links back into f-cave except a hidden passage.
  expect(findRoute(pack, "f-danger", "f-cave")).toBeNull();
  expect(findRoute(pack, "town", "f-cave")).toBeNull(); // hidden link needs the area unlocked
  expect(findRoute(pack, "town", "f-cave", ["isle"])!.map((s) => s.kind)).toEqual(["portal", "portal", "hidden"]);
  expect(findRoute(pack, "town", "town")).toEqual([]);
  expect(nearestTown(pack, "f-danger")).toEqual({ mapId: "town", hops: 3 });
  expect(nearestTown(pack, "town")).toEqual({ mapId: "town", hops: 0 });
});

test("taxis and ships carry their meso cost", () => {
  const pack = smallPack((d) => {
    d.maps.find((m) => m.id === "town")!.links.push({ to: "f-danger", kind: "taxi", costMeso: 1200 });
  });
  expect(findRoute(pack, "town", "f-danger")).toEqual([{ from: "town", to: "f-danger", kind: "taxi", costMeso: 1200 }]);
});

// ---- P4-T5 loot ----
test("findDropSources and rate labels follow §6.3", () => {
  const pack = smallPack();
  const src = findDropSources(pack, "i-wish");
  expect(src.map((s) => [s.mob.id, s.label, s.spotIds])).toEqual([["m-danger", "Seen 3 times in 1,240 kills", ["spot-danger"]]]);
  expect(findDropSources(pack, "i-legacy")).toEqual([]); // legacy-unverified never shown as a source
  expect(rateLabel(pack.index.dropsByItem.get("i-cap")![0]!)).toBe("Confirmed drop · rate not known yet");
  expect(rateLabel(pack.index.dropsByItem.get("i-very-rare")![0]!)).toBe("Rare");
});

test("bestLootTargets ranks wishlist, then class equips and rare items within reach", () => {
  const pack = smallPack();
  expect(bestLootTargets(testProfile(), pack).map((t) => [t.item.id, t.why])).toEqual([
    ["i-hat", "class-equip"], // any class, Lv 28
    ["i-claw", "class-equip"], // thief, Lv 30
    ["i-very-rare", "rare"],
  ]);
  expect(bestLootTargets(testProfile({ wishlistItemIds: ["i-wish"] }), pack)[0]!.item.id).toBe("i-wish");
  expect(bestLootTargets(testProfile({ level: 5 }), pack)).toEqual([]); // nothing within 5 levels drops these
});

// ---- P4-T6 gear ----
test("nextUpgrades: per slot, the next item at or above the level for the family", () => {
  const pack = smallPack();
  expect(nextUpgrades(testProfile(), pack).map((u) => [u.slot, u.item.id, u.how])).toEqual([
    ["hat", "i-hat", ["drop", "craft"]],
    ["weapon", "i-claw", ["drop"]],
  ]);
  expect(nextUpgrades(testProfile({ level: 12 }), pack).find((u) => u.slot === "weapon")!.item.id).toBe("i-old");
  expect(nextUpgrades(testProfile({ jobId: "warrior" }), pack).find((u) => u.slot === "weapon")!.item.id).toBe("i-sword");
});

test("build-matching gear comes first; off-build gear is kept but flagged", () => {
  const pack = smallPack((d) => {
    d.gearProgression = [];
    d.items.find((i) => i.id === "i-claw")!.reqStats = { luk: 60, dex: 25 };
    d.items.find((i) => i.id === "i-hat")!.reqStats = { int: 40 };
  });
  const ups = nextUpgrades(testProfile(), pack, 5, "luk");
  expect(ups.map((u) => [u.item.id, u.fitsBuild])).toEqual([
    ["i-claw", true],
    ["i-hat", false],
  ]);
});

test("nextUpgrades falls back to dropped class equips when there's no curated progression", () => {
  const pack = smallPack((d) => void (d.gearProgression = []));
  expect(nextUpgrades(testProfile(), pack).map((u) => [u.slot, u.item.id, u.derived])).toEqual([
    ["hat", "i-hat", true],
    ["weapon", "i-claw", true],
  ]);
});

// ---- P4-T7 quests ----
describe("quests", () => {
  const q = (id: string, minLevel: number, extra: Partial<PackData["quests"][number]> = {}) => ({
    id,
    name: `Test Quest ${id}`,
    category: "regular" as const,
    minLevel,
    prereqQuestIds: [],
    startNpcId: "npc",
    steps: [],
    rewards: {},
    sources: [{ kind: "in-game" as const, label: "x", retrievedAt: "2026-10-05" }],
    confidence: "verified" as const,
    verifiedAt: "2026-10-05",
    ...extra,
  });
  const pack = smallPack((d) => {
    const { sources, confidence, verifiedAt } = d.monsters[0]!;
    d.npcs.push({ id: "npc", name: "Test NPC", mapId: "town", sources, confidence, verifiedAt });
    d.quests.push(
      q("a", 10, { rewards: { exp: 100 } }),
      q("b", 10, { rewards: { exp: 500 } }),
      q("needs-a", 10, { prereqQuestIds: ["a"] }),
      q("thief-only", 10, { jobs: ["thief"] }),
      q("mage-only", 10, { jobs: ["magician"] }),
      q("soon", 28),
      q("later", 40),
      q("expiring", 10, { availableUntilUtc: "2026-10-08T00:00:00Z", rewards: { exp: 1 } }),
      q("expired", 10, { availableUntilUtc: "2026-10-06T00:00:00Z" }),
      q("too-high", 1, { maxLevel: 20 }),
      q("path-of-the-test", 10, { category: "job", jobs: ["beginner"] }),
      q("thief-advance", 30, { category: "job", jobs: ["thief"] }),
    );
  });
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

  test("available respects level, job line, prerequisites and windows", () => {
    const p = testProfile({ jobId: "bandit", level: 25 });
    expect(ids(availableQuests(p, pack, NOW))).toEqual(["a", "b", "expiring", "thief-only"]);
    const done = testProfile({ jobId: "bandit", level: 25, unlocks: { questsDone: ["a"] } });
    expect(ids(availableQuests(done, pack, NOW))).toEqual(["b", "expiring", "needs-a", "thief-only"]);
  });

  test("job-advancement quests need the exact job", () => {
    expect(ids(availableQuests(testProfile({ jobId: "beginner", level: 10 }), pack, NOW))).toContain("path-of-the-test");
    expect(ids(availableQuests(testProfile({ jobId: "thief", level: 30 }), pack, NOW))).toContain("thief-advance");
    expect(ids(availableQuests(testProfile({ jobId: "thief", level: 30 }), pack, NOW))).not.toContain("path-of-the-test");
    expect(ids(availableQuests(testProfile({ jobId: "bandit", level: 30 }), pack, NOW))).not.toContain("thief-advance");
  });

  test("coming soon: within 5 levels or one prerequisite away", () => {
    expect(ids(comingSoon(testProfile({ level: 25 }), pack, NOW))).toEqual(["needs-a", "soon", "thief-advance"]);
  });

  test("ranking: expiring first, then EXP for the level", () => {
    const p = testProfile({ level: 25 });
    expect(rankQuests(availableQuests(p, pack, NOW), p, pack).map((x) => x.id)).toEqual(["expiring", "b", "a", "thief-only"]);
  });
});

// ---- I-20 projections ----
test("projection maths", () => {
  expect(hoursToLevel(40, 30)).toBeCloseTo(2, 10);
  expect(hoursToLevel(40, 0)).toBeNull();
  expect(paceFromSession(40, 55, 30)).toBeCloseTo(30, 10);
  expect(paceFromSession(90, 10, 30, 1)).toBeCloseTo(40, 10); // wrapped past a level-up
  expect(paceFromSession(50, 40, 30)).toBeNull();
  expect(dropChance(0.01, 0)).toBe(0);
  expect(dropChance(0.01, 100)).toBeCloseTo(1 - 0.99 ** 100, 12);
  expect(killsForChance(0.01, 0.5)).toBe(69);
  expect(killsForChance(0, 0.5)).toBeNull();
  expect(mesoSeries(100, 200, 2, 2)).toEqual([
    { x: 0, low: 0, high: 0 },
    { x: 1, low: 100, high: 200 },
    { x: 2, low: 200, high: 400 },
  ]);
  const t = levelTimeline({ level: 10, expPercent: 50, expPerHour: 100, expToNext: Array(101).fill(100), hours: 3, cap: 100, step: 0.5 });
  expect(t[0]).toEqual({ x: 0, y: 10.5 });
  expect(t.at(-1)!.y).toBeCloseTo(13.5, 10);
  expect(formatDuration(0.75)).toBe("45 min");
  expect(formatDuration(2.25)).toBe("2 h 15 min");
  expect(formatDuration(52)).toBe("2 d 4 h");
});
