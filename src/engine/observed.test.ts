import { smallPack, testProfile as makeProfile } from "../../tests/fixtures/pack.small";
import { estimateSpot } from "./estimate";
import { observedDrops, observedRates } from "./observed";

const obs = (over: object = {}) => ({
  minutes: 30,
  kills: 300,
  exp: 9000,
  meso: 4500,
  killsByMob: {},
  items: { "i-cap": 30, "?:Mystery": 2 },
  levelPercent: 12,
  levelPercentMinutes: 30,
  sessions: 2,
  lastAt: "2026-10-07T00:00:00.000Z",
  ...over,
});

test("watched rates per hour, with picked-up items valued at their NPC price", () => {
  const pack = smallPack();
  const r = observedRates(pack, obs())!;
  const sell = pack.index.itemById.get("i-cap")!.npcSellMeso ?? 0;
  expect(r.killsPerHour.low).toBeCloseTo(540);
  expect(r.killsPerHour.high).toBeCloseTo(660);
  expect((r.expPerHour.low + r.expPerHour.high) / 2).toBeCloseTo(18000);
  expect((r.mesoPerHour.low + r.mesoPerHour.high) / 2).toBeCloseTo((4500 + 30 * sell) * 2);
  expect(r.percentPerHour).toBeCloseTo(24);
  expect(observedRates(pack, obs({ minutes: 5 }))).toBeNull(); // too little watching to trust
  expect(observedRates(pack, obs({ kills: 10 }))).toBeNull();
  expect(observedDrops(obs())).toEqual([{ itemId: "i-cap", drops: 30, kills: 300 }]);
});

test("a watched spot shows measured numbers instead of the engine's guess", () => {
  const pack = smallPack();
  const spot = pack.trainingSpots.find((s) => s.id === "spot-exp")!;
  const base = makeProfile({ level: 25, combat: { damageMin: 50, damageMax: 80 } });
  const guessed = estimateSpot(pack, base, spot);
  expect(guessed.estimate.basis).toBe("computed");
  const watched = estimateSpot(pack, { ...base, observations: { "spot-exp": obs() } }, spot);
  expect(watched.estimate.basis).toBe("observed");
  expect(watched.kph).toBeCloseTo(600);
  expect(watched.estimate.observed?.minutes).toBe(30);
  // Level-band ranking keeps comparing densities, but the shown numbers are still the measured ones.
  const lb = estimateSpot(pack, { ...makeProfile({ level: 25 }), observations: { "spot-exp": obs() } }, spot);
  expect(lb.kph).toBe(estimateSpot(pack, makeProfile({ level: 25 }), spot).kph);
  expect(lb.estimate.expPerHour).not.toBeNull();
});
