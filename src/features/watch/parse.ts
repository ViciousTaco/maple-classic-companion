// I-29 screen watcher — turning OCR text into game events. Pure functions, tuned against real Classic World
// screenshots after launch (the UI isn't public yet), so every pattern is deliberately tolerant.

export type StatusRead = { level: number | null; expPercent: number | null };

/** OCR often confuses these in digits. */
function fixDigits(s: string): string {
  return s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S(?=\d)|(?<=\d)S/g, "5");
}

/** Level ("Lv. 23", "LV 23", "Lv23") and EXP % ("[21.73%]", "21.73 %", "21,73%") from the status-bar region. */
export function parseStatus(lines: string[]): StatusRead {
  const text = lines.join(" ");
  const lv = /\bL[vV]\.?\s*([0-9OoIl|]{1,3})\b/.exec(text);
  const pct = /([0-9OoIl|]{1,3}(?:[.,][0-9OoIl|]{1,3})?)\s*%/.exec(text);
  const level = lv ? Number(fixDigits(lv[1]!)) : NaN;
  const expPercent = pct ? Number(fixDigits(pct[1]!).replace(",", ".")) : NaN;
  return {
    level: Number.isInteger(level) && level >= 1 && level <= 300 ? level : null,
    expPercent: Number.isFinite(expPercent) && expPercent >= 0 && expPercent <= 100 ? expPercent : null,
  };
}

export type ChatEvent = { kind: "exp"; amount: number } | { kind: "meso"; amount: number } | { kind: "item"; name: string };

const num = (s: string) => Number(fixDigits(s).replace(/[,.\s]/g, ""));

/** Pickup / gain messages. Unknown lines are ignored (never guessed). */
export function parseChatLine(line: string): ChatEvent | null {
  const l = line.trim();
  let m = /gained?\s+(?:an?\s+)?(?:experience|exp)\b[^0-9+]*\(?\+?\s*([0-9OoIl|][0-9OoIl|,.\s]*)\)?/i.exec(l);
  if (m) {
    const amount = num(m[1]!);
    return amount > 0 && amount < 10_000_000 ? { kind: "exp", amount } : null;
  }
  m = /gained?\s+(?:some\s+)?mesos?\b[^0-9+]*\(?\+?\s*([0-9OoIl|][0-9OoIl|,.\s]*)\)?/i.exec(l);
  if (m) {
    const amount = num(m[1]!);
    return amount > 0 && amount < 100_000_000 ? { kind: "meso", amount } : null;
  }
  m = /gained?\s+(?:an?\s+)?item\s*\(\s*(.+?)\s*(?:x\s*\d+\s*)?\)/i.exec(l);
  if (m) return { kind: "item", name: m[1]!.trim() };
  m = /^\+\s*([0-9][0-9,]*)\s*(?:exp|experience)\b/i.exec(l);
  if (m) return { kind: "exp", amount: num(m[1]!) };
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
  for (const n of names) {
    const d = editDistance(r, norm(n));
    if (!best || d < best.d) best = { name: n, d };
  }
  return best && best.d <= Math.max(1, Math.floor(r.length / 8)) ? best.name : null;
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
