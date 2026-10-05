import { miniPack, prov } from "./fixtures/miniPack";
import { parsePackFiles, validatePack } from "./validate";
import type { PackData } from "./schema/pack";

const NOW = new Date("2026-10-05T12:00:00Z");
const rulesHit = (p: PackData) => [...new Set(validatePack(p, { now: NOW }).map((i) => i.rule))].sort((a, b) => a - b);

test("the synthetic mini pack is valid", () => {
  const parsed = parsePackFiles(miniPack() as unknown as Record<string, unknown>);
  expect(parsed.issues).toEqual([]);
  expect(validatePack(parsed.pack!, { now: NOW })).toEqual([]);
});

test("rule 1 — a record that doesn't parse is reported with its path", () => {
  const raw = miniPack() as unknown as { monsters: Record<string, unknown>[] };
  delete raw.monsters[0]!.sources;
  const r = parsePackFiles(raw as unknown as Record<string, unknown>);
  expect(r.pack).toBeNull();
  expect(r.issues[0]).toMatchObject({ rule: 1, file: "monsters.json", where: "0.sources" });
});

test("rule 1 — a missing file is reported", () => {
  const raw = miniPack() as unknown as Record<string, unknown>;
  delete raw.meta;
  expect(parsePackFiles(raw).issues).toContainEqual(expect.objectContaining({ rule: 1, file: "meta.json", message: "file is missing" }));
});

test.each<[number, string, (p: PackData) => void]>([
  [1, "duplicate monster id", (p) => p.monsters.push({ ...p.monsters[0]! })],
  [1, "duplicate drop pair", (p) => p.drops.push({ ...p.drops[0]! })],
  [2, "spawn of an unknown monster", (p) => p.maps[1]!.spawns.push({ mobId: "nope", count: 1 })],
  [2, "quest step names an unknown item", (p) => p.quests[0]!.steps.push({ text: "x", kind: "collect", itemId: "nope" })],
  [2, "spot references an unknown video", (p) => p.trainingSpots[0]!.videoIds.push("BBBBBBBBBBB")],
  [3, "verifiedAt in the future", (p) => void (p.monsters[0]!.verifiedAt = "2026-12-01")],
  [4, "verified with only a community source", (p) => Object.assign(p.monsters[1]!, prov("verified", "community"))],
  [5, "exact rate without an official source", (p) => void (p.drops[0]!.rate = { kind: "exact", pct: 1 })],
  [6, "legacy-only record not marked unverified", (p) => Object.assign(p.monsters[1]!, prov("likely", "legacy"))],
  [6, "legacy-only drop not marked legacy-unverified", (p) => Object.assign(p.drops[0]!, prov("unverified", "legacy"))],
  [7, "monster far above the level cap", (p) => void (p.monsters[0]!.level = 140)],
  [7, "band with min > max", (p) => void (p.trainingSpots[0]!.bands[0]!.min = 30)],
  [8, "portal with no way back", (p) => void (p.maps[2]!.links = [])],
  [9, "spot monster that doesn't spawn on its map", (p) => p.trainingSpots[0]!.mobIds.push("mob-b")],
  [10, "event window that ends before it starts", (p) => void (p.events[0]!.windows[0]!.endUtc = "2026-10-05T00:00:00Z")],
  [11, "map in a region that isn't available", (p) => void (p.maps[2]!.region = "region-z")],
  [11, "gated region not in regionsAvailable", (p) => p.meta.gatedRegions.push("region-z")],
  [12, "skill level above its max", (p) => p.skills[0]!.levels!.push({ level: 21 })],
  [13, "MeowDB slug instead of an id", (p) => void (p.maps[1]!.ext = { meowdb: "blue-mushroom" })],
  [14, "focus weights that don't sum to 1", (p) => void (p.focusProfiles.exp.exp = 0.9)],
])("rule %i — %s", (rule, _name, mutate) => {
  const p = miniPack();
  mutate(p);
  expect(rulesHit(p)).toEqual([rule]);
});

test("a one-way portal is fine when noted", () => {
  const p = miniPack();
  p.maps[2]!.links = [];
  p.maps[1]!.links[1]!.note = "one-way drop";
  expect(validatePack(p, { now: NOW })).toEqual([]);
});

test('"integrity" level runs only rules 1–2', () => {
  const p = miniPack();
  p.monsters[0]!.level = 140; // rule 7
  p.maps[1]!.spawns.push({ mobId: "nope", count: 1 }); // rule 2
  expect(validatePack(p, { now: NOW, level: "integrity" }).map((i) => i.rule)).toEqual([2]);
});
