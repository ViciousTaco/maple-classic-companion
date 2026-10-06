import type { ChatEvent } from "./parse";

// I-50: which chat lines are new, and which EXP lines are kills.
//
// EXP messages (modern and Classic alike) stack up from the bottom of the screen and fade after a couple of seconds:
// each new message pushes the older ones up a line. Per kill the modern client prints one "You received EXP (+N)"
// line, then a line per bonus ("Burning Field Bonus EXP", "Buff Bonus EXP", …) — so a kill looks the same every
// time, and the same text can't tell a new message from an old one. Where the lines are on screen can: an old line
// only ever moves up; a new one appears below everything seen before.

/** A line read from the chat box, with where it was (region pixels). */
export type ChatLine = { text: string; y: number; h: number };

/** A line as last seen, and when it first appeared (carried over while it's the same message). */
type Seen = ChatLine & { since: number };

export type ChatTracker = {
  prev: Seen[] | null;
  /**
   * The box has gone empty since watching began: it shows messages that fade (the EXP feed), not a chat log that
   * keeps its lines. Only then can the same text in the same place be a new message.
   */
  fades: boolean;
};

export const newChatTracker = (): ChatTracker => ({ prev: null, fades: false });

/**
 * Fading messages stay readable for about this long (owner's log: 22 of 23 EXP blocks were gone by the next read,
 * 2.3 s later). The same text in the same place, first seen longer ago than this, is a new message.
 */
export const FADE_MS = 2000;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9()+]/g, "");
const digits = (s: string) => (/\(\s*\+?\s*([0-9][0-9,.\s]*)\)/.exec(s)?.[1] ?? "").replace(/\D/g, "");

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Same message read twice (OCR slips allowed); two different amounts are never the same message. */
export function sameLine(a: string, b: string): boolean {
  const da = digits(a);
  const db = digits(b);
  if (da.length >= 3 && db.length >= 3 && levenshtein(da, db) > 1) return false;
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return levenshtein(na, nb) <= Math.max(1, Math.floor(Math.max(na.length, nb.length) * 0.3));
}

/** The lines of this read that weren't there before. The first read only learns what's already showing. */
export function trackChat(tr: ChatTracker, cur: ChatLine[], t: number): string[] {
  const prev = tr.prev;
  const keep = (fresh: ChatLine[], partnerOf: Map<ChatLine, Seen> = new Map()) => {
    const isNew = new Set(fresh);
    tr.prev = cur.map((c) => ({ ...c, since: isNew.has(c) ? t : (partnerOf.get(c)?.since ?? t) }));
    return fresh.map((l) => l.text);
  };
  if (prev === null) return keep([]);
  if (cur.length === 0) {
    if (prev.length > 0) tr.fades = true;
    return keep([]);
  }
  // No positions (some test rigs): fall back to text overlap.
  if (cur.some((l) => !(l.h >= 3)) || prev.some((l) => !(l.h >= 3))) {
    const fresh = newLines(
      prev.map((l) => l.text),
      cur.map((l) => l.text),
    );
    tr.prev = cur.map((c) => ({ ...c, since: t }));
    return fresh;
  }
  if (prev.length === 0) return keep(cur);

  const hs = [...prev, ...cur].map((l) => l.h).sort((a, b) => a - b);
  const tol = hs[hs.length >> 1]! * 0.45;
  const prevBottom = Math.max(...prev.map((l) => l.y));

  // How far did the old lines move up? Try every shift a matching pair suggests; score each by the lines it
  // explains (an exact re-read a little more than a near one), minus lines it can't — one where nothing was
  // before, but not at the bottom where new ones appear. Ties go to the smaller shift (fewer new lines).
  const shifts = new Set<number>([0]);
  for (const p of prev) for (const c of cur) if (p.y - c.y > tol && sameLine(p.text, c.text)) shifts.add(p.y - c.y);
  type Pick = { s: number; score: number; matched: Map<ChatLine, Seen>; changed: Set<ChatLine> };
  let best: Pick = { s: 0, score: -Infinity, matched: new Map(), changed: new Set() };
  for (const s of [...shifts].sort((a, b) => a - b)) {
    const pick: Pick = { s, score: 0, matched: new Map(), changed: new Set() };
    for (const c of cur) {
      if (c.y > prevBottom - s + tol) continue; // below everything seen before: new
      const partner = prev.find((p) => Math.abs(p.y - s - c.y) <= tol);
      if (partner && sameLine(partner.text, c.text)) {
        pick.matched.set(c, partner);
        pick.score += norm(partner.text) === norm(c.text) ? 1.01 : 1;
      } else if (partner) pick.changed.add(c);
      else pick.score -= 1;
    }
    if (pick.score > best.score) best = pick;
  }

  // Unmoved and unchanged: a chat log holding still, or — with fading messages, once the old one would have faded —
  // a new message identical to it in the same place (a kill looks the same every time).
  const inPlace = cur.length === best.matched.size + best.changed.size;
  const firstSeen = Math.min(...[...best.matched.values()].map((p) => p.since));
  if (best.s === 0 && inPlace && best.matched.size >= Math.max(1, cur.length - 1) && tr.fades && t - firstSeen > FADE_MS) return keep(cur);
  // New: below everything seen before. A line in a place that held different text is that line misread when most
  // of the box re-read the same, and new when most of it changed (the box moved on). Anything else is old.
  const settled = best.matched.size >= best.changed.size;
  return keep(
    cur.filter((c) => c.y > prevBottom - best.s + tol || (!settled && best.changed.has(c))),
    best.matched,
  );
}

/**
 * New lines by text alone (no positions): the part of `current` after the longest overlap between the end of
 * `previous` and the start of `current`. No overlap at all → only the last line (OCR noise mustn't double count).
 */
export function newLines(previous: string[], current: string[]): string[] {
  const p = previous.map(norm);
  const c = current.map(norm);
  if (p.length === 0) return current;
  for (let k = Math.min(p.length, c.length); k > 0; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      if (p[p.length - k + i] !== c[i]) {
        same = false;
        break;
      }
    }
    if (same) return current.slice(k);
  }
  const last = current.at(-1);
  return last && norm(last) !== p.at(-1) ? [last] : [];
}

// --- Which EXP lines are kills ---------------------------------------------------------------------------------
//
// A monster gives the same base EXP every time, so the kill line's amount repeats (395,205 at the owner's spot);
// bonus lines are other amounts, and a one-off "You received EXP" (an EXP pickup, a quest) is an amount seen once.
// So an amount is a kill amount once a "received/gained" line has shown it — straight away for the first one here,
// and after it comes round a second time once another kill amount is established (so a one-off pickup isn't a
// kill). A line whose words came out as noise ("E•/.p (+335205)", "(+345205)") is a kill when its amount is a
// kill amount; seen before its amount was known, it's held back and counted when it becomes one.

export type KillBook = { amounts: { amount: number; seen: number; worded: number; pending: number }[] };
export const newKillBook = (): KillBook => ({ amounts: [] });

/** Same amount, allowing one misread digit (OCR reads 395,205 as 335,205) on amounts long enough to be unique. */
export function sameAmount(a: number, b: number): boolean {
  if (a === b) return true;
  const sa = String(a);
  const sb = String(b);
  return sa.length >= 4 && sa.length === sb.length && levenshtein(sa, sb) <= 1;
}

/**
 * Decides which EXP events are kills. Every EXP line still adds its EXP; only kills add to the kill count. A kill
 * line held back as a possible one-off is counted (as a `kill` event) once its amount comes round again.
 */
export function judgeKills(book: KillBook, events: ChatEvent[]): ChatEvent[] {
  const out: ChatEvent[] = [];
  for (const e of events) {
    if (e.kind === "kill" && e.amount === 0) {
      // A kill line with its amount unreadable: the kill amount seen most here (none yet → can't say, skip it).
      const usual = book.amounts.filter((a) => a.worded >= 1).sort((a, b) => b.seen - a.seen)[0];
      if (usual) out.push({ kind: "exp", amount: usual.amount });
      continue;
    }
    if (e.kind !== "exp" || (e.bonus && !e.unclear)) {
      out.push(e);
      continue;
    }
    let k = book.amounts.find((a) => sameAmount(a.amount, e.amount));
    if (!k) {
      k = { amount: e.amount, seen: 0, worded: 0, pending: 0 };
      book.amounts.push(k);
      if (book.amounts.length > 24) book.amounts.splice(book.amounts.indexOf(book.amounts.reduce((a, b) => (b.seen < a.seen ? b : a))), 1);
    }
    k.seen += 1;
    if (!e.unclear) k.worded += 1;
    const established = book.amounts.some((o) => o !== k && o.worded >= 1 && o.seen >= 2);
    if (k.worded >= 1 && (k.seen >= 2 || !established)) {
      for (; k.pending > 0; k.pending--) out.push({ kind: "kill", amount: k.amount });
      out.push({ kind: "exp", amount: e.amount });
    } else {
      k.pending = Math.min(k.pending + 1, MAX_PENDING);
      out.push({ kind: "exp", amount: e.amount, bonus: true });
    }
  }
  return out;
}

/** Kills held back per amount at most (a bonus amount misread as a kill line once mustn't release a pile). */
const MAX_PENDING = 3;
