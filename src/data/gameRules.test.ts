import { activeGameLabel, baselineRules as r, jobLine, jobsForLevel, nextAdvancement, requiredLevel } from "./gameRules";

test("advancement levels come from the pack", () => {
  expect(requiredLevel(r, "beginner")).toBe(1);
  expect(requiredLevel(r, "thief")).toBe(10);
  expect(requiredLevel(r, "bandit")).toBe(30);
});

test("at Lv 9 only Beginner is available", () => {
  expect(jobsForLevel(r, 9).map((j) => j.id)).toEqual(["beginner"]);
});

test("at Lv 30 a Thief's line includes Assassin and Bandit", () => {
  const available = new Set(jobsForLevel(r, 30).map((j) => j.id));
  const line = [...jobLine(r, "thief")].filter((j) => available.has(j));
  expect(line.sort()).toEqual(["assassin", "bandit", "thief"]);
});

test("a 2nd job's line includes its 1st job but not siblings", () => {
  expect([...jobLine(r, "cleric")].sort()).toEqual(["cleric", "magician"]);
});

test("next advancement for a 1st job is Lv 30", () => {
  expect(nextAdvancement(r, "bowman")).toMatchObject({ level: 30, to: ["hunter", "crossbowman"] });
  expect(nextAdvancement(r, "hunter")).toBeUndefined();
});

test("the Founder's Access label disappears at Grand Launch", () => {
  expect(activeGameLabel(r, new Date("2026-10-21T17:59:59Z"))).toBe("Founder's Access");
  expect(activeGameLabel(r, new Date("2026-10-21T18:00:00Z"))).toBeNull();
});
