import { smallPack } from "../../../tests/fixtures/pack.small";
import { hiddenKills, matchName, newLines, parseChatLine, parseStatus } from "./parse";
import { applyEvents, applyStatus, monsterForExp, newSession, percentGained } from "./session";

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

test("chat lines: EXP, meso and item pickups; anything else ignored", () => {
  expect(parseChatLine("You have gained experience (+35)")).toEqual({ kind: "exp", amount: 35 });
  expect(parseChatLine("You have gained mesos (+1,204)")).toEqual({ kind: "meso", amount: 1204 });
  expect(parseChatLine("You have gained an item (Blue Mushroom Cap)")).toEqual({ kind: "item", name: "Blue Mushroom Cap" });
  expect(parseChatLine("+120 EXP")).toEqual({ kind: "exp", amount: 120 });
  expect(parseChatLine("Taco: anyone selling claws?")).toBeNull();
  // Real Windows OCR slips: "m" read as "rn".
  expect(parseChatLine("You have gained rnesos (+33)")).toEqual({ kind: "meso", amount: 33 });
  expect(parseChatLine("You have gained an itern (Horny Mushroom Cap)")).toEqual({ kind: "item", name: "Horny Mushroom Cap" });
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

test("kills hidden by identical chat lines are recovered from the EXP total, only when it divides cleanly", () => {
  expect(hiddenKills(66, 22)).toBe(3);
  expect(hiddenKills(70, 22)).toBe(3); // a little OCR noise
  expect(hiddenKills(500, 22)).toBe(0); // 22.7 kills — quest EXP or a misread, not kills
  expect(hiddenKills(-40, 22)).toBe(0);
  expect(hiddenKills(10, 22)).toBe(0);
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

test("live-client EXP strip and floating EXP lines, as read from a real frame (2026-10-06)", async () => {
  const { parseExpText } = await import("./parse");
  // The light-text clean-up's real output: "[" read as "1".
  expect(parseExpText(["172.672%)"])).toEqual({ expValue: null, expPercent: 72.672 });
  // Misread digits never become a total.
  expect(parseExpText(["172.672%)"], "4 012 909 €93")).toEqual({ expValue: null, expPercent: 72.672 });
  expect(parseExpText(["4.012.4DS.SOSSS3 172.672% I"])).toEqual({ expValue: null, expPercent: 72.672 });
  // A clean read does.
  expect(parseExpText(["172.672%)"], "4 012 406 808 693 [72 672%)")).toEqual({ expValue: 4012406808693, expPercent: 72.672 });
  // Modern chat: base EXP is a kill; bonus lines add EXP only; "Bonus EXP:" is not a player's "Name:" line.
  expect(parseChatLine("You received EXP (+395205)")).toEqual({ kind: "exp", amount: 395205 });
  expect(parseChatLine("Burning Field Bonus EXP: 40% (+158082)")).toEqual({ kind: "exp", amount: 158082, bonus: true });
  expect(parseChatLine("Elven Blessing, Sol Janus Bonus EXP (+142274)")).toEqual({ kind: "exp", amount: 142274, bonus: true });
  expect(parseChatLine("Bob: EXP (+500) lol")).toBeNull();
});

test("kills only from lines that say so — real mangled lines from the owner's log (2026-10-06)", () => {
  const kill = (l: string) => { const e = parseChatLine(l); return e?.kind === "exp" && !e.bonus; };
  const exp = (l: string) => { const e = parseChatLine(l); return e?.kind === "exp" ? e.amount : null; };
  expect(kill("received EZP (+335205)")).toBe(true);
  expect(kill("'{ou received EZP (+335205)")).toBe(true);
  expect(kill("You reteived EXP (+395205)")).toBe(true);
  // Bonus lines with "Bonus" mangled: EXP only, not a kill.
  expect(kill("Ell-lit ZJCJ(ljJ3 E/.P (+1 02753)")).toBe(false);
  expect(exp("Ell-lit ZJCJ(ljJ3 E/.P (+1 02753)")).toBe(102753);
  expect(kill("EXP: (+118561)'")).toBe(false);
  expect(kill("I. 301 30111J3 EZP (+'142274)")).toBe(false);
  // Garbage amounts are dropped, never "+1 EXP".
  expect(parseChatLine("Field ERP: 30% (+1 •1356-1 )")).toBeNull();
  expect(parseChatLine("E•/.p (+335205)")).toEqual({ kind: "exp", amount: 335205, bonus: true });
});
