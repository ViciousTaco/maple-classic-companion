import { bandFit, DEFAULT_FOCUS_WEIGHTS, finalScore, pickPlan, type SubscoreKey } from "./weights";

// Plan §8.7 required tests.
test("bandFit", () => {
  expect(bandFit(20, 20, 30)).toBe(1);
  expect(bandFit(19, 20, 30)).toBeCloseTo(0.667, 3);
  expect(bandFit(17, 20, 30)).toBe(0);
  expect(bandFit(32, 20, 30)).toBeCloseTo(0.6, 10);
  expect(bandFit(35, 20, 30)).toBe(0);
});

test("every weights row sums to 1", () => {
  for (const row of Object.values(DEFAULT_FOCUS_WEIGHTS)) {
    expect(Math.abs(Object.values(row).reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-9);
  }
});

test("finalScore with all subscores 1, fit 1, verified = 1", () => {
  const ones = { exp: 1, meso: 1, drop: 1, equip: 1, safety: 1, convenience: 1 } as Record<SubscoreKey, number>;
  expect(finalScore(ones, DEFAULT_FOCUS_WEIGHTS.balanced, 1, "verified")).toBeCloseTo(1, 12);
  expect(finalScore(ones, DEFAULT_FOCUS_WEIGHTS.balanced, 1, "likely")).toBeCloseTo(0.95, 12);
});

test("pickPlan: backups never share the primary's map, empty → null, stable for equal inputs", () => {
  const r = [
    { id: "a", score: 0.9, mapId: "m1" },
    { id: "b", score: 0.8, mapId: "m1" },
    { id: "c", score: 0.7, mapId: "m2" },
    { id: "d", score: 0.7, mapId: "m3" },
    { id: "e", score: 0.6, mapId: "m2" },
    { id: "f", score: 0.5, mapId: "m4" },
    { id: "g", score: 0.4, mapId: "m5" },
  ];
  const p = pickPlan(r);
  expect(p.primary?.id).toBe("a");
  expect(p.backups.map((b) => b.id)).toEqual(["c", "d", "f"]);
  expect(pickPlan([])).toEqual({ primary: null, backups: [] });
  const ties = [
    { id: "x", score: 0.5, mapId: "a" },
    { id: "y", score: 0.5, mapId: "b" },
  ];
  expect(pickPlan(ties)).toEqual(pickPlan(ties));
  expect(pickPlan(ties).primary?.id).toBe("x");
});
