import { matchName, parseExpText, parseStatus } from "./parse";

// Analyse overhaul (2026-10-06): how each box is read, and how the setup picks the best way for the owner's screen.
// Every choice here was verified on a real live-client frame (tests/frames-private, git-ignored) — if the busy
// modern client reads, Classic's flat UI will.

export type BoxName = "status" | "expText" | "map";
export type Prep = "none" | "lightText" | "brightText";
export type Method = { prep: Prep; filter: "bilinear" | "nearest" };
export type Tuning = Partial<Record<BoxName, Method>>;

/** What works on the live client when nothing has been tuned yet. */
export const DEFAULT_METHOD: Record<BoxName, Method> = {
  status: { prep: "none", filter: "bilinear" },
  map: { prep: "none", filter: "bilinear" },
  // Outlined pale digits on a bright bar: keep only pixels whiter than their row's background.
  expText: { prep: "lightText", filter: "bilinear" },
};

/** Methods the setup's test read tries per box (≤ 4 each, so every box fits one read). */
export const CANDIDATES: Record<BoxName, Method[]> = {
  status: [
    { prep: "none", filter: "bilinear" },
    { prep: "none", filter: "nearest" },
    { prep: "lightText", filter: "bilinear" },
    { prep: "brightText", filter: "bilinear" },
  ],
  expText: [
    { prep: "lightText", filter: "bilinear" },
    { prep: "lightText", filter: "nearest" },
    { prep: "none", filter: "bilinear" },
    { prep: "brightText", filter: "bilinear" },
  ],
  map: [
    { prep: "none", filter: "bilinear" },
    { prep: "none", filter: "nearest" },
    { prep: "lightText", filter: "bilinear" },
    { prep: "brightText", filter: "bilinear" },
  ],
};

export const methodLabel = (m: Method) =>
  `${m.prep === "none" ? "as-is" : m.prep === "lightText" ? "light text" : "bright text"}${m.filter === "nearest" ? ", sharp" : ""}`;

/** Weird characters in what should be a name ("SP{ing", "Li'y•inq") — the sign of a method misreading. */
const oddChars = (text: string) => (text.match(/[^A-Za-z0-9 .,'\-:()[\]%/]/g) ?? []).length;

/**
 * How good a box's reading is for its field (0 = useless). Higher wins — in the setup's test read and in the
 * live tuning that keeps choosing while Analyse runs. `ctx` (the current good values) rewards consistency.
 */
export function scoreReading(
  box: BoxName,
  lines: string[],
  digits: string | undefined,
  profileName: string | null,
  mapNames: string[],
  ctx: { level?: number; expPercent?: number; map?: string } = {},
): number {
  switch (box) {
    case "status": {
      const st = parseStatus(lines);
      const nameOk = profileName ? lines.some((l) => l.split(/\s+/).some((w) => matchName(w, [profileName]) !== null)) : false;
      return (st.level !== null ? 10 : 0) + (nameOk ? 3 : 0) + (st.level !== null && st.level === ctx.level ? 5 : 0);
    }
    case "expText": {
      const e = parseExpText(lines, digits);
      const consistent = e.expPercent !== null && ctx.expPercent !== undefined && Math.abs(e.expPercent - ctx.expPercent) <= 3;
      return (e.expPercent !== null ? 10 : 0) + (e.expValue !== null ? 3 : 0) + (consistent ? 5 : 0);
    }
    case "map": {
      const line = lines.map((l) => l.replace(/\b(?:ch|channel)\.?\s*\d+\b/i, "").trim()).filter((l) => /[A-Za-z]{3,}/.test(l)).at(-1) ?? "";
      if (!line) return 0;
      const words = line.split(/\s+/).filter((w) => /^[A-Z][a-z']+$|^\d+$/.test(w)).length;
      const known = matchName(line, mapNames) !== null;
      return (known ? 10 : 0) + Math.min(words, 5) - 2 * oddChars(line) + (ctx.map && line === ctx.map ? 5 : 0);
    }
  }
}

/** A field's last good reading and when it was taken. */
export type Field<T> = { value: T; at: number } | null;
export type Fields = {
  level: Field<number>;
  name: Field<string>;
  expPercent: Field<number>;
  expValue: Field<number>;
  map: Field<string>;
  /** EXP the current level needs in all (learned from the EXP number ÷ %, see `updateFields`). */
  levelSize: Field<number>;
};
export const NO_FIELDS: Fields = { level: null, name: null, expPercent: null, expValue: null, map: null, levelSize: null };

/** What the last few reads said — the evidence a new value needs before it replaces a good one. */
export type Stabilizer = {
  pendingLevel: number | null;
  pendingPct: number | null;
  /** Reads in a row that showed the pending value (a drop needs three: the same garbled frame can be read twice). */
  pendingVotes: number;
  /** How much the % usually rises per read (smoothed) — what counts as an ordinary step at this pace. */
  stepPct: number | null;
  /** Level-size estimates (EXP number ÷ %) from recent reads, for the level they were read at. */
  sizes: { raw: number; size: number }[];
  sizesLevel: number | null;
  mapWindow: string[];
};
export const newStabilizer = (): Stabilizer => ({ pendingLevel: null, pendingPct: null, pendingVotes: 0, stepPct: null, sizes: [], sizesLevel: null, mapWindow: [] });

/**
 * A rise in the % up to this is ordinary training between two reads until the pace is known; then up to 4× the
 * usual step (at least 0.05 %) — Lv 272 moves ~0.001 % a read, a low Classic level several % a kill.
 */
const PCT_STEP = 0.5;

const MAP_WINDOW = 5;
/** The minimap's map line: the last line with real letters, channel removed. */
export function mapLineOf(lines: string[]): string | null {
  return lines.map((l) => l.replace(/\b(?:ch|channel)\.?\s*\d+\b/i, "").trim()).filter((l) => /[A-Za-z]{3,}/.test(l)).at(-1) ?? null;
}

/**
 * Folds one read into the last-good fields. A value only replaces a good one when it is consistent with it or
 * when two reads in a row agree — so one misread ("3%" after "72.67%", "Living SP{ing 5") never shows.
 */
export function updateFields(
  prev: Fields,
  read: { level: number | null; name: string | null; expPercent: number | null; expValue: number | null; mapLines: string[] },
  t: number,
  stab: Stabilizer,
  isKnownMap: (line: string) => boolean = () => false,
): Fields {
  const f: Fields = { ...prev };
  if (read.level !== null) {
    if (!prev.level || prev.level.value === read.level || stab.pendingLevel === read.level) {
      f.level = { value: read.level, at: t };
      stab.pendingLevel = null;
    } else stab.pendingLevel = read.level;
  }
  if (read.name) f.name = { value: read.name, at: t };
  // The % (owner's log, 2026-10-07: the only part of the live client's EXP strip that reads reliably). A small rise is
  // accepted; the first value or a big jump once the next read backs it (about the same or a little further the same
  // way); a drop once two more reads show it. Real misreads seen: "7" for 72.687 on two reads in a row (the same
  // garbled frame), "72" for 72.687 (a dropped decimal part).
  if (read.expPercent !== null) {
    const p = read.expPercent;
    const last = prev.expPercent?.value;
    const levelledUp = prev.level !== null && f.level !== null && f.level.value > prev.level.value;
    const pend = stab.pendingPct;
    const limit = stab.stepPct === null ? PCT_STEP : Math.max(0.05, 4 * stab.stepPct);
    const small = last !== undefined && p >= last && p - last <= limit;
    // (No good value yet: any steady rise backs the first one; after that, a rise about as big as the jump itself.)
    const backs = pend !== null && p >= pend - 0.001 && p - pend <= Math.max(PCT_STEP, last === undefined ? 10 : Math.abs(pend - last));
    stab.pendingVotes = backs ? stab.pendingVotes + 1 : 1;
    const drop = last !== undefined && p < last;
    const backed = backs && stab.pendingVotes >= (drop ? 3 : 2);
    if (levelledUp || small || backed) {
      f.expPercent = { value: p, at: t };
      if (last !== undefined && p >= last && !levelledUp) stab.stepPct = stab.stepPct === null ? p - last : 0.7 * stab.stepPct + 0.3 * (p - last);
      stab.pendingPct = null;
      stab.pendingVotes = 0;
    } else stab.pendingPct = p;
  }
  // The EXP number. On the live client it mostly reads as garbage ("4 222 725 172" for 4,013,2…), so it is never
  // trusted on its own. Number ÷ % is the level's size: once two reads of *different* numbers give the same size,
  // that size is known; after that a number is shown only when it matches size × % (so a garbled read never shows).
  const level = f.level?.value ?? null;
  if (level !== stab.sizesLevel) {
    stab.sizes = [];
    stab.sizesLevel = level;
    if (prev.level?.value !== level) f.levelSize = null;
  }
  // The % to pair the number with: this read's, else the last good one while it can't have moved much since (a few
  // seconds, or up to a minute when the % creeps — Lv 272 moves ~0.001 % per read).
  const age = prev.expPercent ? t - prev.expPercent.at : Infinity;
  const slow = stab.stepPct !== null && stab.stepPct <= 0.005;
  const pctNow = read.expPercent ?? (prev.expPercent && (age <= 5000 || (slow && age <= 60_000)) ? prev.expPercent.value : null);
  if (read.expValue !== null && pctNow !== null && pctNow >= 1 && level !== null) {
    const size = (read.expValue / pctNow) * 100;
    // Two % rounding errors' worth of slack (the % shows 2 or 3 decimals).
    const tol = Math.max(2e-5, 0.011 / pctNow);
    const match = stab.sizes.find((c) => c.raw !== read.expValue && Math.abs(c.size / size - 1) <= tol);
    if (match) f.levelSize = { value: Math.round((match.size + size) / 2), at: t };
    stab.sizes = [...stab.sizes.filter((c) => c.raw !== read.expValue), { raw: read.expValue, size }].slice(-12);
    const known = f.levelSize?.value;
    if (known && Math.abs(read.expValue - (known * pctNow) / 100) <= known * 0.00006) f.expValue = { value: read.expValue, at: t };
  }
  const line = mapLineOf(read.mapLines);
  if (line) {
    stab.mapWindow = [...stab.mapWindow, line].slice(-MAP_WINDOW);
    const counts = new Map<string, number>();
    for (const l of stab.mapWindow) counts.set(l, (counts.get(l) ?? 0) + 1);
    const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (isKnownMap(line)) f.map = { value: line, at: t };
    else if (n >= 2) f.map = { value: best, at: t };
  }
  return f;
}
