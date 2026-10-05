import { smallPack, testProfile } from "../../tests/fixtures/pack.small";
import type { PackData } from "../data/schema/pack";
import { apAdvice, gearStatNeeds } from "./ap";

const prov = { sources: [{ kind: "community" as const, label: "Fixture", retrievedAt: "2026-10-05" }], confidence: "likely" as const, verifiedAt: "2026-10-05" };
const withBuilds = (mutate?: (d: PackData) => void) =>
  smallPack((d) => {
    d.apBuilds = [
      {
        id: "test-thief",
        name: "Test LUK build",
        jobs: ["thief"],
        recommended: true,
        summary: "x",
        phases: [
          { fromLevel: 10, toLevel: 29, primary: "luk", targets: { dex: { base: 5, perLevel: 1 } }, text: "Keep DEX at level + 5, rest LUK" },
          { fromLevel: 30, primary: "luk", targets: { dex: { base: 40 } }, text: "DEX 40, rest LUK" },
        ],
        ...prov,
      },
      { id: "test-bandit", name: "Test STR bandit", jobs: ["bandit"], summary: "x", phases: [{ fromLevel: 30, primary: "luk", targets: { str: { base: 35 } }, text: "y" }], ...prov },
    ];
    mutate?.(d);
  });

test("advice for the current phase with points still needed", () => {
  const [a] = apAdvice(testProfile({ level: 25, stats: { dex: 20 } }), withBuilds());
  expect(a).toMatchObject({ exact: true, rest: "luk", steps: [{ stat: "dex", target: 30, current: 20, add: 10 }] });
  expect(a!.nextPhase?.fromLevel).toBe(30);
});

test("unknown current stats → target only, no invented shortfall", () => {
  const [a] = apAdvice(testProfile({ level: 25 }), withBuilds());
  expect(a!.steps).toEqual([{ stat: "dex", target: 30, current: null, add: null }]);
});

test("a 2nd job gets its own build first, then its 1st-job build", () => {
  const advice = apAdvice(testProfile({ jobId: "bandit", level: 32 }), withBuilds());
  expect(advice.map((x) => [x.build.id, x.exact])).toEqual([
    ["test-bandit", true],
    ["test-thief", false],
  ]);
});

test("a Beginner build doesn't leak into other classes", () => {
  const pack = withBuilds((d) => d.apBuilds.push({ id: "test-mage", name: "Test INT", jobs: ["beginner", "magician"], summary: "x", phases: [{ fromLevel: 1, primary: "int", text: "z" }], ...prov }));
  expect(apAdvice(testProfile({ jobId: "thief", level: 25 }), pack).map((a) => a.build.id)).toEqual(["test-thief"]);
  expect(apAdvice(testProfile({ jobId: "beginner", level: 5 }), pack).map((a) => a.build.id)).toEqual(["test-mage"]);
});

test("no build for the class or level → nothing (never invented)", () => {
  expect(apAdvice(testProfile({ jobId: "magician", level: 25 }), withBuilds())).toEqual([]);
  expect(apAdvice(testProfile({ level: 5 }), withBuilds())).toEqual([]);
});

test("gear stat needs list unmet requirements of the next upgrades", () => {
  const pack = withBuilds((d) => void (d.items.find((i) => i.id === "i-claw")!.reqStats = { luk: 60, dex: 25 }));
  expect(gearStatNeeds(testProfile({ stats: { luk: 45, dex: 30 } }), pack).map((n) => [n.item.id, n.stat, n.short])).toEqual([["i-claw", "luk", 15]]);
  expect(gearStatNeeds(testProfile(), pack).map((n) => [n.stat, n.short])).toEqual([
    ["luk", null],
    ["dex", null],
  ]);
});
