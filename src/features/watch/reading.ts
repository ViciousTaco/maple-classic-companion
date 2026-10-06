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

/** How good a box's reading is for its field (0 = useless). Higher wins in the setup's test read. */
export function scoreReading(box: BoxName, lines: string[], digits: string | undefined, profileName: string | null, mapNames: string[]): number {
  const text = lines.join(" ");
  switch (box) {
    case "status": {
      const st = parseStatus(lines);
      const nameOk = profileName ? lines.some((l) => l.split(/\s+/).some((w) => matchName(w, [profileName]) !== null)) : false;
      return (st.level !== null ? 10 : 0) + (nameOk ? 3 : 0);
    }
    case "expText": {
      const e = parseExpText(lines, digits);
      return (e.expPercent !== null ? 10 : 0) + (e.expValue !== null ? 3 : 0);
    }
    case "map": {
      const words = text.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z']{2,}$/.test(w)).length;
      const known = lines.some((l) => matchName(l, mapNames) !== null);
      return (known ? 10 : 0) + Math.min(words, 5);
    }
    case "chat": {
      const parsed = lines.filter((l) => parseChatLine(l) !== null).length;
      const words = text.split(/\s+/).filter((w) => /^[A-Za-z]{3,}$/.test(w)).length;
      return parsed * 10 + Math.min(words, 9);
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
