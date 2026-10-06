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
  const bracket = /\[\s*([0-9OoIl|]{1,3})(?:[.,]([0-9OoIl|]{1,3}))?/.exec(text);
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

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9()+]/g, "");

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

/**
 * The EXP text alone ("4,012,189,870,315 [72.668%]" or "EXP 51402 [44.17%]"): the running total and the % to up to
 * three decimals. From a small box drawn around just those digits, which the recogniser reads far better than the
 * whole status bar.
 */
export function parseExpText(lines: string[], digits?: string): { expValue: number | null; expPercent: number | null } {
  const text = lines.join(" ");
  // The %: "[72.672%]". The "[" is often read as "1", "I" or "(" ("172.672%)"), so a leading 1 that makes the value
  // impossible (> 100) is dropped.
  const pct = /\[\s*([0-9OoIl|]{1,3})(?:[.,]([0-9OoIl|]{1,3}))?/.exec(text) ?? /([0-9OoIl|]{1,3})(?:[.,]([0-9OoIl|]{1,3}))?\s*%/.exec(text);
  let whole = pct ? fixDigits(pct[1]!) : "";
  if (whole.length === 3 && Number(whole) > 100 && whole.startsWith("1")) whole = whole.slice(1);
  const expPercent = pct ? Number(`${whole}.${pct[2] ? fixDigits(pct[2]) : "0"}`) : NaN;
  // The total: Windows OCR refuses numbers with two or more thousands separators, so the comma-erased re-read
  // (`digits`) is tried first — its longest digit run before any "[" — then the normal text. Only text that is
  // nothing but digits and separators counts: a misread digit ("4DS", "€93") must not become a wrong total.
  // Erased separators leave gaps ("4 012 207 400 499"): digit groups split by one space or comma are one number.
  const longest = (src: string) =>
    [...src.replace(/\[.*$/, "").replace(/([0-9OoIl|])[ ,](?=[0-9OoIl|]{3}(?![0-9OoIl|]))/g, "$1").matchAll(/[0-9OoIl|][0-9OoIl|,]{2,}/g)]
      .map((m) => fixDigits(m[0]).replace(/,/g, ""))
      .sort((a, b) => b.length - a.length)[0];
  // The run of digits/separators directly before the "[" (or the %): other text in the box (an HP row above,
  // a label) is ignored, and a misread character inside the number cuts it short instead of corrupting it.
  const clean = (src: string) => {
    const head = src.replace(/[[(].*$/, "").replace(/\s*1?\d{1,3}[.,]\d{1,3}\s*%.*$/, "").trimEnd();
    return /([0-9OoIl|][0-9OoIl|.,\s]*)$/.exec(head)?.[1] ?? "";
  };
  const best = (digits ? longest(clean(digits)) : undefined) ?? longest(clean(text));
  const expValue = best ? Number(best) : NaN;
  return {
    expValue: Number.isSafeInteger(expValue) && expValue >= 0 ? expValue : null,
    expPercent: Number.isFinite(expPercent) && expPercent >= 0 && expPercent <= 100 ? expPercent : null,
  };
}
