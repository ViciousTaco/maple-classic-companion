import { smallPack } from "../../../tests/fixtures/pack.small";
import { addSample, expGained, newExpMeter } from "./gain";
import { matchName, parseStatus } from "./parse";
import { newStabilizer, NO_FIELDS, updateFields } from "./reading";
import { applyStatus, killsFromExp, newSession, percentGained } from "./session";

test("status bar: level and EXP % in the shapes OCR produces", () => {
  expect(parseStatus(["Lv. 23  Taco", "EXP 12345 [21.73%]"])).toEqual({ level: 23, expPercent: 21.73, expValue: 12345, name: "Taco" });
  expect(parseStatus(["LV 7", "48,5 %"])).toEqual({ level: 7, expPercent: 48.5, expValue: null, name: null });
  expect(parseStatus(["Lv.2O", "9.O5%"])).toMatchObject({ level: 20, expPercent: 9.05 }); // O read for 0
  // Real Windows OCR of a status bar (2026-10-06): "%]" came back as "0/01".
  expect(parseStatus(["Lv. 23", "Demo", "EXP 51402 [44.170/01"])).toEqual({ level: 23, expPercent: 44.17, expValue: 51402, name: "Demo" });
  expect(parseStatus(["IV. 31  Demo"]).level).toBe(31); // OCR read "Lv." as "IV."
  expect(parseStatus(["1v 8"]).level).toBe(8);
  expect(parseStatus(["Level up!"]).level).toBeNull(); // "ev" inside a word isn't a level
  expect(parseStatus(["nothing useful"])).toEqual({ level: null, expPercent: null, expValue: null, name: null });
  expect(parseStatus(["Lv. 999", "250%"])).toMatchObject({ level: null, expPercent: null }); // impossible values dropped
});

test("names tolerate small OCR slips", () => {
  const names = ["Blue Mushroom Cap", "Red Potion", "Snail Shell"];
  expect(matchName("Blue Mushrcom Cap", names)).toBe("Blue Mushroom Cap");
  expect(matchName("red potion", names)).toBe("Red Potion");
  expect(matchName("Dragon Scale", names)).toBeNull();
});

test("level progress from the status bar, across a level-up", () => {
  let s = newSession("spot-exp", "f-exp", new Date("2026-10-07T00:00:00Z"));
  s = applyStatus(s, 25, 40);
  s = applyStatus(s, 26, 10);
  expect(percentGained(s)).toBe(70);
});

test("training time only counts while the EXP bar keeps rising, and sessions fold into per-spot totals", async () => {
  const { tick, mergeSession } = await import("./session");
  const t0 = Date.parse("2026-10-07T00:00:00Z");
  let s = newSession("spot-exp", "f-exp", new Date(t0));
  s = tick(s, 2000, t0 + 2000); // nothing gained yet → not counted
  expect(s.activeMs).toBe(0);
  s = { ...s, exp: 48, kills: 2, lastKillAt: t0 + 4000 };
  s = tick(s, 2000, t0 + 6000);
  s = tick(s, 600_000, t0 + 10_000); // suspend gap capped at 10 s
  s = tick(s, 2000, t0 + 120_000); // >60 s since the bar last rose → idle
  expect(s.activeMs).toBe(12_000);
  const obs = mergeSession({}, s, new Date(t0 + 120_000));
  expect(obs["spot-exp"]).toMatchObject({ kills: 2, exp: 48, minutes: 0.2, sessions: 1 });
  const twice = mergeSession(obs, s, new Date(t0 + 120_000));
  expect(twice["spot-exp"]).toMatchObject({ kills: 4, exp: 96, sessions: 2 });
  expect(mergeSession(obs, newSession("spot-exp", "f-exp", new Date(t0)), new Date(t0))).toBe(obs); // nothing gained → unchanged
});

test("kills are estimated from EXP on a guide map (EXP ÷ its monsters' EXP)", () => {
  const pack = smallPack();
  expect(killsFromExp(pack, "f-exp", 240)).toBe(10); // Test Mob m-fast gives 24
  expect(killsFromExp(pack, "f-exp", 0)).toBeNull();
  expect(killsFromExp(pack, null, 240)).toBeNull(); // a map the guide doesn't know
});

test("the EXP-numbers box: exact total and % to three decimals (owner's live-client magnifier, 2026-10-06)", async () => {
  const { parseExpText } = await import("./parse");
  expect(parseExpText(["4,012,189,870,315 [72.668%]"])).toEqual({ expValue: 4012189870315, expPercent: 72.668 });
  expect(parseExpText(["14982 / 33063", "4,O12,189,870,315 [72.668%]"])).toEqual({ expValue: 4012189870315, expPercent: 72.668 }); // HP row above, O for 0
  expect(parseExpText(["EXP 51402 [44.170/01"])).toEqual({ expValue: 51402, expPercent: 44.17 });
  expect(parseExpText(["nothing"])).toEqual({ expValue: null, expPercent: null });
  // What Windows OCR really returns for the live client's strip: the % only — plus the comma-erased re-read.
  expect(parseExpText(["[72.668%)"], "4 012 189 870 315 [72 668%)")).toEqual({ expValue: 4012189870315, expPercent: 72.668 });
  expect(parseExpText(["[42.620%)"], "4 012 207 400 499 [42 620%)")).toEqual({ expValue: 4012207400499, expPercent: 42.62 }); // exact engine output
  expect(parseExpText(["EXP 51402 [44.17%]"], "51402 [44 17%]")).toEqual({ expValue: 51402, expPercent: 44.17 }); // Classic-style, no separators
});

test("live-client EXP strip, as read from a real frame (2026-10-06)", async () => {
  const { parseExpText } = await import("./parse");
  // The light-text clean-up's real output: "[" read as "1".
  expect(parseExpText(["172.672%)"])).toEqual({ expValue: null, expPercent: 72.672 });
  // Misread digits never become a total.
  expect(parseExpText(["172.672%)"], "4 012 909 €93")).toEqual({ expValue: null, expPercent: 72.672 });
  expect(parseExpText(["4.012.4DS.SOSSS3 172.672% I"])).toEqual({ expValue: null, expPercent: 72.672 });
  // A clean read does.
  expect(parseExpText(["172.672%)"], "4 012 406 808 693 [72 672%)")).toEqual({ expValue: 4012406808693, expPercent: 72.672 });
});

// --- EXP gained from the bar (owner, 2026-10-07: messages fly past too fast; use the EXP number and the time) ---

const LV272 = 5_521_215_000_000; // ≈ the owner's level 272 (4,012,406,808,693 at 72.672 %)

test("EXP gained is the rise in the EXP number, however many kills happened between reads", () => {
  const m = newExpMeter();
  addSample(m, { level: 272, pct: 72.672, total: 4_012_406_808_693 });
  addSample(m, { level: 272, pct: 72.69, total: 4_013_406_808_693 }); // ~1,250 kills' worth in one read: all counted
  expect(expGained(m)).toBe(1_000_000_000);
  // A read where only the % came through: the level's size (learned from the number ÷ %) turns it into EXP.
  addSample(m, { level: 272, pct: 72.71, total: null });
  expect(expGained(m)).toBeGreaterThan(1_000_000_000);
});

test("a misread in between never adds up: only the first and latest readings count", () => {
  const m = newExpMeter({ 50: 1_000_000 });
  addSample(m, { level: 50, pct: 10, total: 100_000 });
  addSample(m, { level: 50, pct: 20, total: 200_000 });
  addSample(m, { level: 50, pct: 30, total: 300_000 });
  expect(expGained(m)).toBe(200_000);
});

test("a level-up counts the rest of the old level, then the new one from zero", () => {
  const m = newExpMeter({ 50: 1_000_000, 51: 2_000_000 });
  addSample(m, { level: 50, pct: 90, total: 900_000 });
  addSample(m, { level: 51, pct: 1, total: 20_000 });
  expect(expGained(m)).toBe(100_000 + 20_000);
});

test("a death penalty isn't 'gained' and isn't taken off what was", () => {
  const m = newExpMeter({ 272: LV272 });
  addSample(m, { level: 272, pct: 72.0, total: null });
  addSample(m, { level: 272, pct: 72.1, total: null });
  const before = expGained(m)!;
  addSample(m, { level: 272, pct: 71.1, total: null }); // died
  expect(expGained(m)).toBe(before);
  addSample(m, { level: 272, pct: 71.2, total: null });
  expect(expGained(m)).toBeCloseTo(before * 2, -4);
});

test("% only, level not in the guide and no EXP number yet: EXP can't be told (progress still comes from the %)", () => {
  const m = newExpMeter();
  addSample(m, { level: 272, pct: 72.0, total: null });
  addSample(m, { level: 272, pct: 72.1, total: null });
  expect(expGained(m)).toBeNull();
});

test("the EXP number is accepted while it rises, when it agrees with the % (number ÷ % stays the level's size)", () => {
  const stab = newStabilizer();
  const read = (pct: number, total: number) => ({ level: 272, name: null, expPercent: pct, expValue: total, mapLines: [] });
  let f = updateFields(NO_FIELDS, read(72.672, 4_012_406_808_693), 0, stab);
  expect(f.expValue).toBeNull(); // one read alone isn't trusted
  f = updateFields(f, read(72.68, 4_012_848_505_893), 1000, stab); // rose by 0.008 % and 441.7M: consistent
  expect(f.expValue?.value).toBe(4_012_848_505_893);
  f = updateFields(f, read(72.69, 4_912_000_000_000), 2000, stab); // a misread digit: ratio way off
  expect(f.expValue?.value).toBe(4_012_848_505_893);
});
