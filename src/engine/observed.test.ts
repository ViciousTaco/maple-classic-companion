import { smallPack, testProfile as makeProfile } from "../../tests/fixtures/pack.small";
import { estimateSpot } from "./estimate";
import { observedDrops, observedRates, ownDropRate, paceFactor } from "./observed";
import { calibration } from "./estimate";

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

test("own drop rate: only where the monster is the sole dropper of that item on the map", () => {
  const pack = smallPack();
  const observations = {
    "spot-exp": { ...obs(), killsByMob: { "m-fast": 300 }, items: { "i-cap": 30 } },
    "map:f-meso": { ...obs(), killsByMob: { "m-rich": 50 }, items: { "i-sell": 5 } },
  };
  expect(ownDropRate(pack, observations, "m-fast", "i-cap")).toEqual({ drops: 30, kills: 300 });
  expect(ownDropRate(pack, observations, "m-rich", "i-sell")).toEqual({ drops: 5, kills: 50 });
  expect(ownDropRate(pack, observations, "m-fast", "i-sell")).toBeNull(); // m-fast doesn't drop it
  expect(ownDropRate(pack, { "spot-exp": { ...obs(), killsByMob: { "m-fast": 10 }, items: { "i-cap": 1 } } }, "m-fast", "i-cap")).toBeNull(); // < 20 kills
  expect(paceFactor([{ predicted: 100, observed: 130 }, { predicted: 200, observed: 300 }, { predicted: 50, observed: 60 }])).toEqual({ factor: 1.3, spots: 3 });
  expect(paceFactor([{ predicted: 100, observed: 900 }])).toEqual({ factor: 2, spots: 1 }); // clamped
  expect(paceFactor([])).toBeNull();
});

test("calibration: measured spots scale the computed estimates of unmeasured ones", () => {
  const pack = smallPack();
  const base = makeProfile({ level: 25, combat: { damageMin: 50, damageMax: 80 } });
  expect(calibration(pack, base)).toBeNull();
  const spot = pack.trainingSpots.find((s) => s.id === "spot-exp")!;
  const predicted = estimateSpot(pack, base, spot, "computed", null).kph;
  // The owner actually kills 1.4× faster than predicted at spot-exp.
  const minutes = 30;
  const kills = Math.round(predicted * 1.4 * (minutes / 60));
  const p = { ...base, observations: { "spot-exp": obs({ minutes, kills, exp: kills * 24 }) } };
  const c = calibration(pack, p)!;
  expect(c.spots).toBe(1);
  expect(c.factor).toBeCloseTo(1.4, 1);
  const other = pack.trainingSpots.find((s) => s.id === "spot-drop")!;
  const plain = estimateSpot(pack, base, other, "computed", null);
  const scaled = estimateSpot(pack, p, other);
  expect(scaled.estimate.calibration).toEqual(c);
  expect(scaled.estimate.killsPerHour!.low).toBeCloseTo(plain.estimate.killsPerHour!.low * c.factor, 6);
  // A level-band character (no damage known) gets no calibration.
  expect(calibration(pack, { ...makeProfile({ level: 25 }), observations: p.observations })).toBeNull();
});
