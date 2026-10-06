import { expect, test } from "vitest";
import { parseChatLine, type ChatEvent } from "./parse";
import { FADE_MS, judgeKills, newChatTracker, newKillBook, sameAmount, sameLine, trackChat, type ChatLine } from "./kills";
import { applyEvents, newSession } from "./session";
import { smallPack } from "../../../tests/fixtures/pack.small";

// I-50: kills from the EXP messages on the right of the owner's screen (live client, 2026-10-06). Per kill:
// "You received EXP (+395,205)", then a line per bonus. Messages stack up from the bottom and fade in ~2 s.

const H = 19;
/** A block of messages ending at the feed's bottom line (y = 200); earlier lines sit above it. */
const at = (lines: string[], bottom = 200): ChatLine[] => lines.map((text, i) => ({ text, y: bottom - (lines.length - 1 - i) * H, h: 16 }));
const KILL = ["You received EXP (+395205)", "Elven Blessing, Sol Janus Bonus EXP (+142274)", "Buff Bonus EXP (+102753)", "Burning Field Bonus EXP: 40% (+158082)"];

test("the first read only learns what's already showing", () => {
  const tr = newChatTracker();
  expect(trackChat(tr, at(KILL), 0)).toEqual([]);
});

test("a new kill pushes the last one up: only its lines are new", () => {
  const tr = newChatTracker();
  trackChat(tr, [], 0);
  expect(trackChat(tr, at(KILL), 2300)).toEqual(KILL);
  // 1 s later another kill: the first block moved up 4 lines, the new block is below it (OCR read one old line differently).
  const next = at([KILL[0]!, "Elven Blessing, Sol Janus Bonus EXP (+142274)", "Buff Bonus EXP (+1O2753)", KILL[3]!, ...KILL]);
  expect(trackChat(tr, next, 3300)).toEqual(KILL);
});

test("the same kill again in the same place, after the last one faded, is a new kill", () => {
  const tr = newChatTracker();
  trackChat(tr, [], 0);
  trackChat(tr, at(KILL), 2300);
  expect(trackChat(tr, [], 4600)).toEqual([]); // faded
  expect(trackChat(tr, at(KILL), 6900)).toEqual(KILL);
  // …and with no empty read in between (it faded and the next kill came within one read).
  expect(trackChat(tr, at(KILL), 6900 + FADE_MS + 300)).toEqual(KILL);
});

test("a message still showing on a quick re-read is not new", () => {
  const tr = newChatTracker();
  trackChat(tr, [], 0);
  trackChat(tr, at(KILL), 2300);
  expect(trackChat(tr, at(KILL.map((l) => l.replace("Bonus", "Bonvs"))), 2300 + 900)).toEqual([]);
});

test("a chat log that holds still (never empties) never counts its lines again", () => {
  const tr = newChatTracker();
  const log = at(["[MapleTip] Use the system options…", "You have gained experience (+24)", "You have gained experience (+24)"]);
  trackChat(tr, log, 0);
  for (let i = 1; i <= 5; i++) expect(trackChat(tr, log, i * 2300)).toEqual([]);
  // It scrolls by one: only the bottom line is new.
  const scrolled = at(["You have gained experience (+24)", "You have gained experience (+24)", "You have gained mesos (+15)"]);
  expect(trackChat(tr, scrolled, 6 * 2300)).toEqual(["You have gained mesos (+15)"]);
});

test("a box that changed completely is all new; one misread line in a settled box is not", () => {
  const tr = newChatTracker();
  trackChat(tr, at(["a line", "another line", "third line here"]), 0);
  expect(trackChat(tr, at(["a line", "anXther liXe", "third line here"]), 900)).toEqual([]);
  expect(trackChat(tr, at(["You received EXP (+395205)", "Buff Bonus EXP (+102753)", "Burning Field Bonus EXP: 40% (+158082)"]), 1800)).toHaveLength(3);
});

test("two different amounts are never the same message; one misread digit is the same amount", () => {
  expect(sameLine("You received EXP (+395205)", "You received EXP (+102753)")).toBe(false);
  expect(sameLine("received EZP (+335205)", "'{ou received EZP (+335205)")).toBe(true);
  expect(sameAmount(395205, 335205)).toBe(true);
  expect(sameAmount(395205, 142274)).toBe(false);
  expect(sameAmount(24, 25)).toBe(false); // short amounts must match exactly
});

const judge = (book: ReturnType<typeof newKillBook>, lines: string[]) => judgeKills(book, lines.map(parseChatLine).filter((e): e is ChatEvent => e !== null));
const kills = (events: ChatEvent[]) => events.filter((e) => e.kind === "kill" || (e.kind === "exp" && !e.bonus)).length;

test("one kill per block: bonus lines and mangled bonus lines add EXP only (real lines from the owner's log)", () => {
  const book = newKillBook();
  expect(kills(judge(book, ["received EZP (+335205)", "I. 301 30111-13 (+142274)", "ZIIJii 30111J3 E/.P (Fl 02753)"]))).toBe(1);
  expect(kills(judge(book, ["'{ou received EZP (+335205)", "I. 301 J;-lfllJ3 30111J3 EZP (+'142274)", "EXP: (+118561)'"]))).toBe(1);
  // Words lost, amount kept: the kill amount makes it a kill (395,205 misread as 335,205 is the same amount).
  expect(kills(judge(book, ["E•/.p (+335205)", "I. 301 30111J3 EZP (+'1 42274)", "Ell-lit ZJCJ(ljJ3 E/.P (+1 02753)"]))).toBe(1);
  expect(kills(judge(book, ["e/,.P (+335205)"]))).toBe(1);
  expect(kills(judge(book, ["(+345205)"]))).toBe(1);
  // Says "received" but the amount came out as noise: still a kill, of the usual amount.
  const garbled = judge(book, ["received (+\"$CJö2fJ5)"]);
  expect(garbled).toEqual([{ kind: "exp", amount: 335205 }]);
  // A bonus block with its kill line unreadable: no kill invented.
  expect(kills(judge(book, ["sol Bonus EXP (+1 42274)", "Field Zlr-J(llJ3 E/.P• ( + •l •1356-1 )"]))).toBe(0);
});

test("an EXP pickup (\"You received EXP\" once, another amount) is not a kill; a second monster's amount is, once it repeats", () => {
  const book = newKillBook();
  judge(book, ["You received EXP (+395205)"]);
  judge(book, ["You received EXP (+395205)"]);
  expect(judge(book, ["You received EXP (+667575)"])).toEqual([{ kind: "exp", amount: 667575, bonus: true }]);
  // Another monster here (88,410 EXP): held back once, then both count.
  expect(kills(judge(book, ["You received EXP (+88410)"]))).toBe(0);
  const again = judge(book, ["You received EXP (+88410)"]);
  expect(again).toEqual([{ kind: "kill", amount: 88410 }, { kind: "exp", amount: 88410 }]);
});

test("mangled kill lines read before the first clear one are counted once it shows the amount", () => {
  const book = newKillBook();
  expect(kills(judge(book, ["EZP (+335205)"]))).toBe(0);
  expect(kills(judge(book, ["You received EXP (+395205)"]))).toBe(2);
});

test("held-back and unreadable-amount kills add to the session's kills without adding EXP twice", () => {
  const pack = smallPack();
  let s = newSession(null, null, new Date(0));
  s = applyEvents(s, [{ kind: "exp", amount: 100, bonus: true }, { kind: "kill", amount: 100 }, { kind: "exp", amount: 100 }], pack, 1);
  expect(s).toMatchObject({ kills: 2, exp: 200 });
});

test("reading every second: a message is the same one until it would have faded, then a new one in its place", () => {
  const tr = newChatTracker();
  trackChat(tr, at(["Spell Trace earned. (Etc)"]), -2000);
  trackChat(tr, [], 0); // the feed emptied: it fades
  expect(trackChat(tr, at(KILL), 1300)).toEqual(KILL);
  expect(trackChat(tr, at(KILL), 2600)).toEqual([]); // still the same kill (1.3 s old)
  expect(trackChat(tr, at(KILL), 3900)).toEqual(KILL); // 2.6 s on, that one has faded: this is the next kill
  expect(trackChat(tr, at(KILL), 5200)).toEqual([]);
});
