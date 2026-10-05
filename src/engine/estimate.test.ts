import { smallPack, testProfile } from "../../tests/fixtures/pack.small";
import { estimateSpot } from "./estimate";

const spotOf = (pack: ReturnType<typeof smallPack>, id: string) => pack.index.spotById.get(id)!;
const combat = (min: number, max: number, extra = {}) => ({ combat: { damageMin: min, damageMax: max, ...extra } });

test("100-HP mob with damage 40–60 → 2 hits to kill", () => {
  const pack = smallPack((d) => void (d.monsters.find((m) => m.id === "m-fast")!.hp = 100));
  const e = estimateSpot(pack, testProfile(combat(40, 60)), spotOf(pack, "spot-exp"));
  expect(e.estimate.basis).toBe("computed");
  expect(e.estimate.hitsToKill).toBe(2);
  expect(e.estimate.expPerHour).not.toBeNull();
  expect(e.hitChanceAssumed).toBe(true);
});

test("the spawn cap binds when the player is faster than respawn", () => {
  const pack = smallPack((d) => void (d.meta.defaultRespawnSec = 60));
  const fast = estimateSpot(pack, testProfile(combat(5000, 5000)), spotOf(pack, "spot-exp"));
  // Player alone: 3600 / (0.8/0.9 + 1.5) ≈ 1507/h. Spawns: 12 every 60 s → 720/h, capped at 85 % = 612/h.
  expect(3600 / (0.8 / 0.9 + 1.5)).toBeGreaterThan(720);
  expect(fast.kph).toBeCloseTo((0.85 * 12 * 3600) / 60, 6);
});

test("missing respawn data → spawn cap not applied", () => {
  const pack = smallPack((d) => void (d.meta.defaultRespawnSec = null));
  const e = estimateSpot(pack, testProfile(combat(5000, 5000)), spotOf(pack, "spot-exp"));
  // 1 hit / 0.9 hit chance × 0.8 s + 1.5 s mobility
  expect(e.kph).toBeCloseTo(3600 / (0.8 / 0.9 + 1.5), 6);
});

test("no combat stats → level-band basis with null rates", () => {
  const pack = smallPack();
  const e = estimateSpot(pack, testProfile(), spotOf(pack, "spot-exp"));
  expect(e.estimate).toMatchObject({ basis: "level-band", hitsToKill: null, killsPerHour: null, expPerHour: null, mesoPerHour: null });
  expect(e.kph).toBeCloseTo(12 / 8, 10); // relative density, never displayed
});

test("danger thresholds at 8 and 4 hits to die", () => {
  const pack = smallPack();
  const danger = (hp: number) => estimateSpot(pack, testProfile({ stats: { hp } }), spotOf(pack, "spot-danger")).estimate.danger;
  expect(danger(2400)).toBe("safe"); // 300 touch × 8
  expect(danger(2399)).toBe("caution");
  expect(danger(1200)).toBe("caution"); // × 4
  expect(danger(1199)).toBe("dangerous");
  expect(estimateSpot(pack, testProfile(), spotOf(pack, "spot-danger")).estimate.danger).toBe("unknown");
});

test("a two-mob spot weights by spawn count (and equally when counts are unknown)", () => {
  const pack = smallPack((d) => {
    d.maps.find((m) => m.id === "f-exp")!.spawns.push({ mobId: "m-rich", count: 4 });
    d.trainingSpots.find((s) => s.id === "spot-exp")!.mobIds.push("m-rich");
  });
  const e = estimateSpot(pack, testProfile(), spotOf(pack, "spot-exp"));
  expect(e.mobs.map((m) => [m.mob.id, m.weight])).toEqual([
    ["m-fast", 0.75],
    ["m-rich", 0.25],
  ]);
  expect(e.expPerKill).toBeCloseTo(0.75 * 24 + 0.25 * 18, 10);

  const unknown = smallPack((d) => {
    const map = d.maps.find((m) => m.id === "f-exp")!;
    map.spawns = [{ mobId: "m-fast" }, { mobId: "m-rich" }];
    d.trainingSpots.find((s) => s.id === "spot-exp")!.mobIds.push("m-rich");
  });
  expect(estimateSpot(unknown, testProfile(), spotOf(unknown, "spot-exp")).mobs.map((m) => m.weight)).toEqual([0.5, 0.5]);
});

test("an attack skill with damagePct 200 and 3 targets halves hits-to-kill and applies aoe 2.0", () => {
  const pack = smallPack((d) => {
    d.monsters.find((m) => m.id === "m-fast")!.hp = 200;
    d.meta.defaultRespawnSec = null;
  });
  const base = estimateSpot(pack, testProfile(combat(50, 50)), spotOf(pack, "spot-exp"));
  const skilled = estimateSpot(pack, testProfile({ ...combat(50, 50, { mainSkillId: "sk-multi" }), skills: { "sk-multi": 1 } }), spotOf(pack, "spot-exp"));
  expect(base.estimate.hitsToKill).toBe(4);
  expect(skilled.estimate.hitsToKill).toBe(2);
  const secBase = (4 * 0.8) / 0.9 + 1.5;
  const secSkill = (2 * 0.8) / 0.9 + 1.5;
  expect(base.kph).toBeCloseTo(3600 / secBase, 6);
  expect(skilled.kph).toBeCloseTo((2.0 * 3600) / secSkill, 6);
});

test("a skill the character hasn't learned is ignored", () => {
  const pack = smallPack();
  const e = estimateSpot(pack, testProfile(combat(50, 50, { mainSkillId: "sk-multi" })), spotOf(pack, "spot-exp"));
  expect(e.estimate.hitsToKill).toBe(2); // 80 HP / 50
});

test("meso per hour comes from meso drops plus sell value × rate weight", () => {
  const pack = smallPack();
  const e = estimateSpot(pack, testProfile(combat(5000, 5000)), spotOf(pack, "spot-meso"));
  expect(e.mesoPerKill).toBeCloseTo(80 + 200 * 0.05, 10);
  expect(e.estimate.mesoPerHour!.low).toBeCloseTo(e.kph * e.mesoPerKill! * 0.8, 6);
  // No meso data at all → null, not 0.
  expect(estimateSpot(pack, testProfile(combat(50, 50)), spotOf(pack, "spot-exp")).estimate.mesoPerHour).toBeNull();
});
