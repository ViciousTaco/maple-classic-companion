import { smallPack, testProfile } from "../../../tests/fixtures/pack.small";
import { describeStats, parseSkillsWindow, parseStatsWindow, statsChanges, type Line } from "./windows";

// Lines as Windows OCR returns them: label and value sometimes in one line, sometimes in separate boxes on a row.
const L = (text: string, x: number, y: number, w = text.length * 8, h = 16): Line => ({ text, x, y, w, h });

test("the Character Stats window, with labels and values in one line", () => {
  const r = parseStatsWindow([
    L("Lv. 23 Demo", 10, 10),
    L("HP 912 / 912", 10, 40),
    L("MP 340/355", 10, 60),
    L("STR 35", 10, 90),
    L("DEX 25", 10, 110),
    L("INT 4", 10, 130),
    L("LUK 6O", 10, 150), // O for 0
    L("Damage 40 ~ 90", 10, 180),
    L("Accuracy 56", 10, 200),
    L("Avoidability 31", 10, 220),
    L("Attack 35", 10, 240), // weapon attack: ignored
    L("EXP 51,402 [44.17%]", 10, 260),
  ])!;
  expect(r.expPercent).toBe(44.17);
  expect(r.stats).toEqual({ hp: 912, mp: 355, str: 35, dex: 25, int: 4, luk: 60 });
  expect(r.combat).toEqual({ damageMin: 40, damageMax: 90, accuracy: 56, avoid: 31 });
});

test("labels and values in separate columns are paired by row", () => {
  const r = parseStatsWindow([
    L("INT", 10, 70, 30),
    L("4", 120, 68),
    L("LUK", 10, 130, 30),
    L("3", 120, 129),
    L("STR", 10, 90, 30),
    L("35 (30 + 5)", 120, 91),
    L("DEX", 10, 110, 30),
    L("25", 120, 109),
    L("Avoid.", 10, 150, 48),
    L("31", 120, 150),
    L("HP", 10, 40, 20),
    L("912 / 912", 120, 40),
  ])!;
  // Tight rows: each label takes the value on its own row, never a neighbour's.
  expect(r.stats).toEqual({ str: 35, dex: 25, hp: 912, int: 4, luk: 3 });
  expect(r.combat).toEqual({ avoid: 31 });
});

test("ordinary screen text is never mistaken for the stats window", () => {
  expect(parseStatsWindow([L("You have gained experience (+24)", 10, 500), L("STR 35", 10, 90)])).toBeNull(); // no DEX
  expect(parseStatsWindow([])).toBeNull();
});

test("the Skills window: names with OCR slips, levels as n / max, lone numbers or MAX", () => {
  const skills = [
    { id: "lucky-seven", name: "Lucky Seven", maxLevel: 20 },
    { id: "double-stab", name: "Double Stab", maxLevel: 20 },
    { id: "haste", name: "Haste", maxLevel: 20 },
    { id: "nimble-body", name: "Nimble Body", maxLevel: 20 },
  ];
  const r = parseSkillsWindow(
    [
      L("Lucky Seven  12 / 20", 40, 100),
      L("Double Stab", 40, 130, 90),
      L("7", 260, 131),
      L("Haste MAX", 40, 160),
      L("Nimble Body 25", 40, 190), // above max → misread, dropped
      L("Dark Sight 3 / 20", 40, 220), // not one of this job's skills in the list
    ],
    skills,
  );
  expect(r).toEqual({ "lucky-seven": 12, "double-stab": 7, haste: 20 });
  expect(parseSkillsWindow([L("STR 35", 10, 10)], skills)).toBeNull();
});

test("only differences are applied, and are described plainly", () => {
  const p = testProfile({ stats: { str: 35, dex: 20 }, combat: { damageMin: 40, damageMax: 90 } });
  const c = statsChanges(p, { stats: { str: 35, dex: 25, luk: 60 }, combat: { damageMin: 40, damageMax: 90, accuracy: 56 } })!;
  expect(c).toEqual({ stats: { dex: 25, luk: 60 }, combat: { accuracy: 56 } });
  expect(describeStats(c)).toBe("DEX 25, LUK 60, accuracy 56");
  expect(statsChanges(p, { stats: { str: 35, dex: 20 }, combat: {} })).toBeNull();
  expect(smallPack().skills.length).toBeGreaterThan(0);
});
