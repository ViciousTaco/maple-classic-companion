// I-29 screen watcher — turning OCR text into game events. Pure functions, tuned against real Classic World
// screenshots after launch (the UI isn't public yet), so every pattern is deliberately tolerant.

export type StatusRead = { level: number | null; expPercent: number | null; expValue: number | null; name: string | null };

/** OCR often confuses these in digits. */
export function fixDigits(s: string): string {
  return s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S(?=\d)|(?<=\d)S/g, "5");
}

/**
 * Level ("Lv. 23"), EXP total ("EXP 51402") and EXP % from the status-bar region. The game shows the % in brackets
 * ("[44.17%]"); Windows OCR often mangles the "%]" (seen: "[44.170/01"), so the bracket is read first and only two
 * decimals are kept.
 */
export function parseStatus(lines: string[]): StatusRead {
  const text = lines.join(" ");
  // "Lv." is sometimes read as "IV.", "lv" or "1v".
  const lv = /(?:^|[^A-Za-z])[LlI1|][vV]\.?\s*([0-9OoIl|]{1,3})\b/.exec(text);
  const bracket = /\[\s*([0-9OoIl|]{1,3})(?:[.,]([0-9OoIl|]{1,2}))?/.exec(text);
  const pct = bracket ?? /([0-9OoIl|]{1,3})(?:[.,]([0-9OoIl|]{1,3}))?\s*%/.exec(text);
  const total = /EXP\s*:?\s*([0-9OoIl|][0-9OoIl|,]{0,13})/i.exec(text);
  // The character's name sits between the level and the EXP/HP/MP figures on the status bar.
  const afterLevel = lv ? text.slice(lv.index + lv[0].length) : "";
  const nm = /^[^A-Za-z]*([A-Za-z][A-Za-z0-9]{2,12})\b/.exec(afterLevel);
  const name = nm && !/^(EXP|HP|MP|LV|LEVEL)$/i.test(nm[1]!) ? nm[1]! : null;
  const level = lv ? Number(fixDigits(lv[1]!)) : NaN;
  const expPercent = pct ? Number(`${fixDigits(pct[1]!)}.${pct[2] ? fixDigits(pct[2]) : "0"}`) : NaN;
  const expValue = total ? Number(fixDigits(total[1]!).replace(/,/g, "")) : NaN;
  return {
    level: Number.isInteger(level) && level >= 1 && level <= 300 ? level : null,
    expPercent: Number.isFinite(expPercent) && expPercent >= 0 && expPercent <= 100 ? expPercent : null,
    expValue: Number.isSafeInteger(expValue) && expValue >= 0 ? expValue : null,
    name,
  };
}

export type ChatEvent = { kind: "exp"; amount: number } | { kind: "meso"; amount: number } | { kind: "item"; name: string };

const num = (s: string) => Number(fixDigits(s).replace(/[,.\s]/g, ""));
const AMOUNT = /\(\s*\+?\s*([0-9OoIl|][0-9OoIl|,.\s]*?)\s*\)|\+\s*([0-9][0-9,.]*)/;

/**
 * Pickup / gain messages. Unknown lines are ignored (never guessed). Keywords are matched on a copy with common OCR
 * slips undone ("rn" for "m": "rnesos", "itern"); numbers and item names come from the line as read.
 */
export function parseChatLine(line: string): ChatEvent | null {
  const l = line.trim();
  const k = l.toLowerCase().replace(/rn/g, "m");
  // System messages start the line ("You have gained …", optionally after a "[Tag]"); anything after a "Name:"
  // prefix is a player talking. Lines with a "Name:" prefix are never gains, whatever follows.
  if (/^[^:(]{1,24}:\s/.test(l)) return null;
  const systemStart = /^(?:\[[^\]]{1,24}\]\s*)?[^a-z]{0,3}(?:you\s+have\s+|\+\s*\d)/.test(k);
  const amount = () => {
    const m = AMOUNT.exec(l);
    return m ? num(m[1] ?? m[2]!) : NaN;
  };
  if (systemStart && /gain\w*\s+(?:an?\s+)?item\b/.test(k)) {
    const m = /\(\s*(.+?)\s*(?:x\s*\d+\s*)?\)/.exec(l);
    return m ? { kind: "item", name: m[1]!.trim() } : null;
  }
  if (systemStart && /gain\w*\s+(?:some\s+)?mes\w*/.test(k)) {
    const a = amount();
    return a > 0 && a < 100_000_000 ? { kind: "meso", amount: a } : null;
  }
  if (systemStart && (/gain\w*\s+(?:an?\s+)?ex\w*/.test(k) || /^\+\s*\d[\d,]*\s*ex\w*/.test(k))) {
    const a = amount();
    return a > 0 && a < 10_000_000 ? { kind: "exp", amount: a } : null;
  }
  // Words unreadable but the shape is unmistakable: an EXP-like token ("EXP", "EZP", "E/.P") and a "(+N)" amount.
  // Seen on the live client, where the chat font defeats OCR but the digits survive.
  if (/\bE(?:X|Z|[^\w\s]{1,3})?P\b/.test(l) && /\(\s*\+/.test(l)) {
    const a = amount();
    return a > 0 && a < 10_000_000 ? { kind: "exp", amount: a } : null;
  }
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9()+]/g, "");

/**
 * New chat lines since the previous read. The chat box shows the last N lines, so new lines are the part of
 * `current` after the longest overlap between the end of `previous` and the start of `current`.
 * With no overlap at all, everything counts as new only when `previous` was empty (first read); otherwise only the
 * last line does (prevents double counting when OCR noise breaks the overlap).
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

/** Name matching that tolerates OCR slips (case, punctuation, one or two wrong letters). */
export function matchName(raw: string, names: string[]): string | null {
  const r = norm(raw);
  if (!r) return null;
  let best: { name: string; d: number } | null = null;
  let tie = false;
  for (const n of names) {
    const d = editDistance(r, norm(n));
    if (!best || d < best.d) {
      best = { name: n, d };
      tie = false;
    } else if (d === best.d && norm(n) !== norm(best.name)) tie = true;
  }
  // A tie means two names are equally close (e.g. "Ant Tunnel II" vs "IV" with one bad letter): say nothing.
  return best && !tie && best.d <= Math.max(1, Math.floor(r.length / 8)) ? best.name : null;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
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

/**
 * Kills hidden from the chat box: when every visible line is the same (one monster type, nothing else picked up),
 * new lines can't be told from old ones. The status bar's EXP total still rises, so `delta / amount` kills happened
 * (only when it divides cleanly, so quest EXP or a level-up isn't counted as kills).
 */
export function hiddenKills(expDelta: number, amount: number): number {
  if (!(expDelta > 0) || !(amount > 0)) return 0;
  const k = Math.round(expDelta / amount);
  return k >= 1 && k <= 60 && Math.abs(expDelta - k * amount) <= amount * 0.2 ? k : 0;
}

/**
 * The map the player is on, from the minimap's title box. The minimap also shows the area ("Victoria Island") and
 * sometimes a channel, so every line is tried and the clean match wins; no match → null (keep the previous map).
 */
export function parseMapName(lines: string[], mapNames: string[]): string | null {
  for (const raw of lines) {
    // Drop the channel, then repair a trailing roman numeral: OCR reads "III" as "Ill", "II" as "ll" or "1I".
    const line = raw
      .replace(/\b(?:ch|channel)\.?\s*\d+\b/i, "")
      .trim()
      .replace(/\s([IVXil1|]{1,4})$/, (_, n: string) => ` ${n.replace(/[il1|]/g, "I")}`);
    if (line.length < 3) continue;
    const hit = matchName(line, mapNames);
    if (hit) return hit;
  }
  return null;
}
