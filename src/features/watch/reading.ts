import { matchName, parseChatLine, parseExpText, parseStatus } from "./parse";

// Analyse overhaul (2026-10-06): how each box is read, and how the setup picks the best way for the owner's screen.
// Every choice here was verified on a real live-client frame (tests/frames-private, git-ignored) — if the busy
// modern client reads, Classic's flat UI will.

export type BoxName = "status" | "expText" | "chat" | "map";
export type Prep = "none" | "lightText" | "brightText";
export type Method = { prep: Prep; filter: "bilinear" | "nearest" };
export type Tuning = Partial<Record<BoxName, Method>>;

/** What works on the live client when nothing has been tuned yet. */
export const DEFAULT_METHOD: Record<BoxName, Method> = {
  status: { prep: "none", filter: "bilinear" },
  map: { prep: "none", filter: "bilinear" },
  chat: { prep: "none", filter: "bilinear" },
  // Outlined pale digits on a bright bar: keep only pixels whiter than their row's background.
  expText: { prep: "lightText", filter: "bilinear" },
};

/** Methods the setup's test read tries per box (≤ 4 each, so four boxes fit one read). */
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
  chat: [
    { prep: "none", filter: "bilinear" },
    { prep: "lightText", filter: "bilinear" },
    { prep: "brightText", filter: "bilinear" },
    { prep: "none", filter: "nearest" },
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
  const text = lines.join(" ");
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
    case "chat": {
      const parsed = lines.filter((l) => parseChatLine(l) !== null).length;
      const words = text.split(/\s+/).filter((w) => /^[A-Za-z]{3,}$/.test(w)).length;
      return parsed * 10 + Math.min(words, 9) - oddChars(text);
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
};
export const NO_FIELDS: Fields = { level: null, name: null, expPercent: null, expValue: null, map: null };

/** What the last few reads said — the evidence a new value needs before it replaces a good one. */
export type Stabilizer = { pendingLevel: number | null; pendingPct: number | null; lastExpRaw: number | null; mapWindow: string[] };
export const newStabilizer = (): Stabilizer => ({ pendingLevel: null, pendingPct: null, lastExpRaw: null, mapWindow: [] });

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
  if (read.expPercent !== null) {
    const p = read.expPercent;
    const last = prev.expPercent?.value;
    const levelledUp = prev.level !== null && f.level !== null && f.level.value > prev.level.value;
    const agrees = stab.pendingPct !== null && Math.abs(stab.pendingPct - p) <= 0.05;
    if (last === undefined || Math.abs(p - last) <= 3 || levelledUp || agrees) {
      f.expPercent = { value: p, at: t };
      stab.pendingPct = null;
    } else stab.pendingPct = p;
  }
  if (read.expValue !== null) {
    if (read.expValue === stab.lastExpRaw) f.expValue = { value: read.expValue, at: t };
    stab.lastExpRaw = read.expValue;
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
