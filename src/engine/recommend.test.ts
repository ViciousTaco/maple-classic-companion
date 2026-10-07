import { NOW, smallPack, smallPackData, testProfile } from "../../tests/fixtures/pack.small";
import { buildIndexes } from "../data/pack";
import { validatePack } from "../data/validate";
import { FOCUS_IDS, type FocusId } from "../data/schema/profile";
import { estimateSpot } from "./estimate";
import { normalise, rawSubscores } from "./subscores";
import { recommendTraining } from "./recommend";

const plan = (over = {}, pack = smallPack()) => recommendTraining({ profile: testProfile(over), pack, now: NOW });

test("the fixture itself passes the datapack validator", () => {
  expect(validatePack(smallPackData(), { now: NOW })).toEqual([]);
});

test.each<[FocusId, string]>([
  ["exp", "spot-exp"],
  ["meso", "spot-meso"],
  ["rare-drop", "spot-drop"],
  ["class-equip", "spot-equip"],
  ["balanced", "spot-mix"],
])("focus %s picks %s", (focus, winner) => {
  expect(plan({ focus }).primary?.spotId).toBe(winner);
});

test("primary and backups are on different maps; same-map duplicates never become backups", () => {
  const p = plan({ focus: "exp" });
  const maps = [p.primary!, ...p.backups].map((r) => r.mapId);
  expect(new Set(maps).size).toBe(maps.length);
  expect(p.backups.map((b) => b.spotId)).not.toContain("spot-exp-alt");
  expect(p.backups.length).toBe(3);
});

test("a skipped spot is excluded until its time passes", () => {
  const until = new Date(NOW.getTime() + 90 * 60_000).toISOString();
  const skipped = plan({ focus: "exp", skippedSpots: [{ spotId: "spot-exp", until }] });
  expect(skipped.primary?.spotId).toBe("spot-exp-alt"); // same map, still allowed — only the skipped spot goes
  const later = recommendTraining({ profile: testProfile({ focus: "exp", skippedSpots: [{ spotId: "spot-exp", until }] }), pack: smallPack(), now: new Date(Date.parse(until) + 1) });
  expect(later.primary?.spotId).toBe("spot-exp");
});

test("a party-only spot is never primary and is listed separately", () => {
  for (const focus of ["exp", "meso", "rare-drop", "class-equip", "balanced"] as FocusId[]) {
    const p = plan({ focus, level: 30 });
    expect(p.primary?.spotId).not.toBe("spot-party");
    expect(p.backups.map((b) => b.spotId)).not.toContain("spot-party");
    expect(p.partySpots.map((s) => s.spotId)).toEqual(["spot-party"]);
  }
});

test("a gated region appears only once the area is unlocked", () => {
  const locked = plan({ focus: "exp" });
  const unlocked = plan({ focus: "exp", unlocks: { areas: ["gated-isle"] } });
  const ids = (p: typeof locked) => [p.primary, ...p.backups].map((r) => r?.spotId);
  expect(ids(locked)).not.toContain("spot-gated");
  expect(unlocked.considered).toBe(locked.considered + 1);
});

test("skipping every candidate → emptyReason all-skipped", () => {
  const until = new Date(NOW.getTime() + 3_600_000).toISOString();
  const all = smallPack().trainingSpots.map((s) => ({ spotId: s.id, until }));
  const p = plan({ skippedSpots: all });
  expect(p.primary).toBeNull();
  expect(p.emptyReason).toBe("all-skipped");
});

test("with only one fitting map, the relaxed-band backup is flagged stretch", () => {
  const pack = smallPack((d) => void (d.trainingSpots = d.trainingSpots.filter((s) => s.id === "spot-exp" || s.id === "spot-low")));
  const p = plan({ level: 21 }, pack);
  expect(p.primary?.spotId).toBe("spot-exp");
  expect(p.primary?.stretch).toBe(false);
  expect(p.backups.map((b) => [b.spotId, b.stretch])).toEqual([["spot-low", true]]);
  expect(p.backups[0]!.warnings.map((w) => w.code)).toContain("stretch-option");
});

test("empty pack → no-data-for-level (never an invented spot)", () => {
  const pack = smallPack((d) => void (d.trainingSpots = []));
  expect(plan({}, pack)).toMatchObject({ primary: null, backups: [], emptyReason: "no-data-for-level" });
});

test("a level with no spots → no-data-for-level", () => {
  expect(plan({ level: 80 }).emptyReason).toBe("no-data-for-level");
});

test("deterministic: same input gives deep-equal output", () => {
  const a = plan({ focus: "balanced", stats: { hp: 900 }, combat: { damageMin: 30, damageMax: 55 } });
  const b = plan({ focus: "balanced", stats: { hp: 900 }, combat: { damageMin: 30, damageMax: 55 } });
  expect(a).toEqual(b);
});

test("reasons and warnings explain the pick", () => {
  const p = plan({ focus: "exp" });
  expect(p.primary!.reasons[0]).toEqual({ code: "best-exp", params: { rank: 1, of: p.considered } });
  expect(p.primary!.warnings.map((w) => w.code)).toContain("estimate-from-level-only");
  const equip = plan({ focus: "class-equip" });
  expect(equip.primary!.reasons[0]).toEqual({ code: "drops-class-equip", params: { itemId: "i-claw" } });
  expect(equip.primary!.notableDropItemIds).toEqual(["i-claw"]);
  const computed = plan({ focus: "exp", combat: { damageMin: 40, damageMax: 60 }, stats: { hp: 100 } });
  const danger = [computed.primary!, ...computed.backups].find((r) => r.spotId === "spot-danger");
  expect(danger?.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["dangerous-mob", "hit-chance-assumed"]));
});

// ---- P4-T3 subscores ----
describe("subscores", () => {
  const pack = smallPack();
  const prof = testProfile();
  const raw = (id: string, p = prof) => rawSubscores(pack, p, pack.index.spotById.get(id)!, estimateSpot(pack, p, pack.index.spotById.get(id)!));

  test("normalised to a max of 1; all-zero stays 0", () => {
    const n = normalise([raw("spot-exp"), raw("spot-meso"), raw("spot-drop")]);
    expect(Math.max(...n.map((s) => s.exp))).toBe(1);
    expect(n.map((s) => s.equip)).toEqual([0, 0, 0]);
  });

  test("legacy-unverified drops are ignored", () => {
    // i-legacy is "rare" but its only drop is legacy-unverified → spot-exp has no drop score.
    expect(raw("spot-exp").drop).toBe(0);
  });

  test("a wishlisted item triples its contribution", () => {
    const plain = raw("spot-drop").drop;
    const wished = raw("spot-drop", testProfile({ wishlistItemIds: ["i-very-rare"] })).drop;
    expect(wished).toBeCloseTo(plain * 3, 12);
  });

  test("equip window [level, level+10] and job family are respected", () => {
    expect(raw("spot-equip").equip).toBeGreaterThan(0); // i-claw: thief, Lv 30
    expect(raw("spot-equip", testProfile({ level: 19 })).equip).toBe(0); // 30 > 19+10
    expect(raw("spot-equip", testProfile({ level: 31 })).equip).toBe(0); // 30 < 31
    expect(raw("spot-equip", testProfile({ jobId: "magician" })).equip).toBe(0); // neither claw nor sword
    expect(raw("spot-equip", testProfile({ jobId: "warrior" })).equip).toBeGreaterThan(0); // i-sword
  });
});

// ---- P4-T9 invariants ----
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("invariants over 500 seeded random profiles", () => {
  const rnd = mulberry32(20261007);
  const pack = buildIndexes(smallPackData());
  const jobs = pack.jobs.map((j) => j.id);
  const focuses: FocusId[] = ["exp", "meso", "rare-drop", "class-equip", "balanced"];
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  for (let i = 0; i < 500; i++) {
    const sparse = rnd() < 0.4;
    const profile = testProfile({
      level: 1 + Math.floor(rnd() * 100),
      jobId: pick(jobs),
      focus: pick(focuses),
      ...(sparse ? {} : { stats: { hp: Math.floor(rnd() * 3000) }, combat: { damageMin: 1 + Math.floor(rnd() * 200), damageMax: 200 + Math.floor(rnd() * 400) } }),
      unlocks: { areas: rnd() < 0.5 ? ["gated-isle"] : [] },
      wishlistItemIds: rnd() < 0.3 ? ["i-wish", "i-rare"] : [],
    });
    const p = recommendTraining({ profile, pack, now: NOW });
    const recs = [p.primary, ...p.backups].filter((r) => r !== null);
    const maps = recs.map((r) => r.mapId);
    expect(new Set(maps).size).toBe(maps.length);
    for (const r of [...recs, ...p.partySpots]) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      const region = pack.index.mapById.get(r.mapId)!.region;
      expect(pack.meta.regionsAvailable).toContain(region);
      if (region === "gated-isle") expect(profile.unlocks.areas).toContain("gated-isle");
    }
    if (!p.primary) expect(p.emptyReason).toBeDefined();
  }
});

test("levelling up moves the main pick on: it's always a spot whose band includes the level, when there is one (real data)", async () => {
  const { sourcePack } = await import("../data/fixtures/sourcePack");
  const { bestBand } = await import("./recommend");
  const pack = sourcePack();
  const bowman = pack.jobs.find((j) => /bowman/i.test(j.name))!.id;
  for (const focus of FOCUS_IDS)
    for (let level = 1; level <= 30; level++) {
      const profile = testProfile({ jobId: bowman, level, focus });
      const p = recommendTraining({ profile, pack, now: NOW });
      const inBand = pack.trainingSpots.some((s) => s.party !== "party" && bestBand(pack, profile, s)?.fit === 1);
      if (inBand) expect(p.primary?.fit, `${focus} Lv ${level}`).toBe(1);
    }
  // The owner's case (2026-10-07): Lv 11 Bowman, Balanced — not the Lv 4–10 field any more.
  const p = recommendTraining({ profile: testProfile({ jobId: bowman, level: 11, focus: "balanced" }), pack, now: NOW });
  expect(pack.index.mapById.get(p.primary!.mapId)?.name).not.toBe("The Field West of Amherst");
});
