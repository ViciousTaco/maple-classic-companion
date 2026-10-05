import { miniPack } from "../src/data/fixtures/miniPack";
import { coverage, formatCoverage } from "./coverage-report";

// @vitest-environment node

test("counts spots per band and archetype, quests per band, and confidence", () => {
  const c = coverage(miniPack());
  const band = (min: number) => c.bands.find((b) => b.min === min)!;
  // spot-a covers Lv 8–15 for "any" → bands 6–10 and 11–15 for every archetype
  expect(band(6).spots).toEqual({ melee: 1, ranged: 1, mage: 1 });
  expect(band(11).spots).toEqual({ melee: 1, ranged: 1, mage: 1 });
  expect(band(16).spots).toEqual({ melee: 0, ranged: 0, mage: 0 });
  expect(band(1).quests).toBe(1); // quest-a starts at Lv 5
  expect(band(6).quests).toBe(1); // quest-a: minLevel 5, no max
  expect(c.confidence.likely).toBe(1); // mob-b
  expect(c.gaps).toContain("Lv 6–10 melee: 1 spot(s), need 2");
  expect(c.gaps).toContain("EXP table (expToNext) unknown");
});

test("party-only spots don't count towards solo coverage", () => {
  const p = miniPack();
  p.trainingSpots[0]!.party = "party";
  expect(coverage(p).bands.find((b) => b.min === 6)!.spots.melee).toBe(0);
});

test("the report prints a table and the gaps", () => {
  const text = formatCoverage(coverage(miniPack()), "2026.10.05-1");
  expect(text).toMatch(/Levels {3}\| melee \| ranged \| mage \| quests/);
  expect(text).toContain("6–10     |     1 |      1 |    1 |      1");
});
