import { smallPack } from "../../../tests/fixtures/pack.small";
import { matchName, newLines, parseChatLine, parseStatus } from "./parse";
import { applyEvents, applyStatus, monsterForExp, newSession, percentGained } from "./session";

test("status bar: level and EXP % in the shapes OCR produces", () => {
  expect(parseStatus(["Lv. 23  Taco", "EXP 12345 [21.73%]"])).toEqual({ level: 23, expPercent: 21.73 });
  expect(parseStatus(["LV 7", "48,5 %"])).toEqual({ level: 7, expPercent: 48.5 });
  expect(parseStatus(["Lv.2O", "9.O5%"])).toEqual({ level: 20, expPercent: 9.05 }); // O read for 0
  expect(parseStatus(["nothing useful"])).toEqual({ level: null, expPercent: null });
  expect(parseStatus(["Lv. 999", "250%"])).toEqual({ level: null, expPercent: null }); // impossible values dropped
});

test("chat lines: EXP, meso and item pickups; anything else ignored", () => {
  expect(parseChatLine("You have gained experience (+35)")).toEqual({ kind: "exp", amount: 35 });
  expect(parseChatLine("You have gained mesos (+1,204)")).toEqual({ kind: "meso", amount: 1204 });
  expect(parseChatLine("You have gained an item (Blue Mushroom Cap)")).toEqual({ kind: "item", name: "Blue Mushroom Cap" });
  expect(parseChatLine("+120 EXP")).toEqual({ kind: "exp", amount: 120 });
  expect(parseChatLine("Taco: anyone selling claws?")).toBeNull();
});

test("only new chat lines are counted between reads", () => {
  expect(newLines([], ["a", "b"])).toEqual(["a", "b"]);
  expect(newLines(["a", "b", "c", "d"], ["c", "d", "e", "f"])).toEqual(["e", "f"]);
  expect(newLines(["a", "b"], ["a", "b"])).toEqual([]);
  expect(newLines(["You gained (+35)"], ["you gained (+35) ", "x"])).toEqual(["x"]); // case/space noise
  expect(newLines(["a", "b"], ["q", "r"])).toEqual(["r"]); // no overlap → at most the newest line
});

test("item names tolerate small OCR slips", () => {
  const names = ["Blue Mushroom Cap", "Red Potion", "Snail Shell"];
  expect(matchName("Blue Mushrcom Cap", names)).toBe("Blue Mushroom Cap");
  expect(matchName("red potion", names)).toBe("Red Potion");
  expect(matchName("Dragon Scale", names)).toBeNull();
});

test("a session counts kills by monster (from the EXP amount), meso, pickups and level progress", () => {
  const pack = smallPack();
  expect(monsterForExp(pack, "f-exp", 24)).toBe("m-fast");
  expect(monsterForExp(pack, "f-exp", 999)).toBe("?");
  let s = newSession("spot-exp", "f-exp", new Date("2026-10-07T00:00:00Z"));
  s = applyStatus(s, 25, 40);
  s = applyEvents(
    s,
    [
      { kind: "exp", amount: 24 },
      { kind: "exp", amount: 24 },
      { kind: "meso", amount: 15 },
      { kind: "item", name: "Test Item i-cap" },
      { kind: "item", name: "Unknown Thing" },
    ],
    pack,
  );
  s = applyStatus(s, 26, 10);
  expect(s).toMatchObject({ kills: 2, exp: 48, meso: 15, killsByMob: { "m-fast": 2 }, items: { "i-cap": 1, "?:Unknown Thing": 1 } });
  expect(percentGained(s)).toBe(70);
});

test("training time only counts while kills keep coming, and sessions fold into per-spot totals", async () => {
  const pack = smallPack();
  const { tick, mergeSession } = await import("./session");
  const t0 = Date.parse("2026-10-07T00:00:00Z");
  let s = newSession("spot-exp", "f-exp", new Date(t0));
  s = tick(s, 2000, t0 + 2000); // no kill yet → not counted
  expect(s.activeMs).toBe(0);
  s = applyEvents(s, [{ kind: "exp", amount: 24 }], pack, t0 + 4000);
  s = tick(s, 2000, t0 + 6000);
  s = tick(s, 600_000, t0 + 10_000); // suspend gap capped at 10 s
  s = tick(s, 2000, t0 + 120_000); // >60 s since the last kill → idle
  expect(s.activeMs).toBe(12_000);
  const obs = mergeSession({}, s, new Date(t0 + 120_000));
  expect(obs["spot-exp"]).toMatchObject({ kills: 1, exp: 24, minutes: 0.2, sessions: 1 });
  const twice = mergeSession(obs, s, new Date(t0 + 120_000));
  expect(twice["spot-exp"]).toMatchObject({ kills: 2, exp: 48, sessions: 2, killsByMob: { "m-fast": 2 } });
  expect(mergeSession(obs, newSession("spot-exp", "f-exp", new Date(t0)), new Date(t0))).toBe(obs); // nothing seen → unchanged
});
