import type { Profile } from "../../data/schema/profile";
import { fixDigits, matchName } from "./parse";

// I-29 follow-up (owner): when the in-game Character Stats or Skills window is open, read it and update the
// character automatically. Works on a whole-window read, so the windows can be anywhere on screen.
// Everything here is pure; the controller decides when to scan and applies only values read twice in a row.

export type Line = { text: string; x: number; y: number; w: number; h: number };

export type StatsRead = {
  stats: Partial<Pick<Profile["stats"], "str" | "dex" | "int" | "luk" | "hp" | "mp">>;
  combat: Partial<Pick<Profile["combat"], "damageMin" | "damageMax" | "accuracy" | "avoid">>;
};

const NUM = "[0-9OoIl|][0-9OoIl|,]*";
const num = (s: string) => Number(fixDigits(s).replace(/,/g, ""));

/** Lines on the same row as `line` (vertical centres within half a line height), to its right, nearest first. */
function rightOf(line: Line, all: Line[]): Line[] {
  const cy = line.y + line.h / 2;
  return all
    .filter((o) => o !== line && o.x >= line.x + line.w * 0.6 && Math.abs(o.y + o.h / 2 - cy) <= Math.max(line.h, o.h) * 0.6)
    .sort((a, b) => a.x - b.x);
}

/** The first number in a line, or in the nearest line to its right (labels and values are often separate boxes). */
function valueFor(line: Line, all: Line[], pattern: RegExp): RegExpExecArray | null {
  const own = pattern.exec(line.text.replace(/^[A-Za-z. ]+/, ""));
  if (own) return own;
  for (const r of rightOf(line, all).slice(0, 2)) {
    const m = pattern.exec(r.text);
    if (m) return m;
  }
  return null;
}

const single = new RegExp(`(${NUM})`);
const pair = new RegExp(`(${NUM})\\s*(?:/|~|-|to)\\s*(${NUM})`);

/**
 * The Character Stats window: STR/DEX/INT/LUK, HP/MP ("900 / 900" → the maximum), the damage range
 * ("40 ~ 90"), accuracy and avoidability. Labels are matched loosely; a lone "Attack 35" is ignored because weapon
 * attack is not a damage range. Returns null unless at least STR and DEX were found (so random text never counts).
 */
export function parseStatsWindow(lines: Line[]): StatsRead | null {
  const out: StatsRead = { stats: {}, combat: {} };
  const inRange = (v: number, max: number) => Number.isInteger(v) && v >= 0 && v <= max;
  for (const line of lines) {
    const label = line.text.trim().toLowerCase().replace(/[^a-z]/g, "");
    const key = (["str", "dex", "int", "luk"] as const).find((k) => label.startsWith(k));
    if (key) {
      const m = valueFor(line, lines, single);
      if (m) {
        const v = num(m[1]!);
        if (inRange(v, 9999)) out.stats[key] = v;
      }
      continue;
    }
    if (/^(hp|mp)/.test(label)) {
      const k = label.slice(0, 2) as "hp" | "mp";
      const p = valueFor(line, lines, pair);
      const m = p ?? valueFor(line, lines, single);
      if (m) {
        const v = num(p ? p[2]! : m[1]!);
        if (inRange(v, 99999)) out.stats[k] = v;
      }
      continue;
    }
    if (/^(damage|dmg|attack|atk)/.test(label)) {
      const p = valueFor(line, lines, pair);
      if (p) {
        const [lo, hi] = [num(p[1]!), num(p[2]!)];
        if (inRange(lo, 999999) && inRange(hi, 999999) && lo <= hi && lo > 0) {
          out.combat.damageMin = lo;
          out.combat.damageMax = hi;
        }
      }
      continue;
    }
    if (/^(accuracy|acc)/.test(label)) {
      const m = valueFor(line, lines, single);
      if (m && inRange(num(m[1]!), 9999)) out.combat.accuracy = num(m[1]!);
      continue;
    }
    if (/^(avoid|avoidability|evasion)/.test(label)) {
      const m = valueFor(line, lines, single);
      if (m && inRange(num(m[1]!), 9999)) out.combat.avoid = num(m[1]!);
    }
  }
  return out.stats.str !== undefined && out.stats.dex !== undefined ? out : null;
}

export type SkillDefLite = { id: string; name: string; maxLevel: number };

/**
 * The Skills window: each row is a skill name with its level ("12 / 20", "12", or "MAX"). Names tolerate OCR
 * slips; a level above the skill's maximum is a misread and is dropped. Null unless a skill was recognised.
 */
export function parseSkillsWindow(lines: Line[], skills: SkillDefLite[]): Record<string, number> | null {
  const names = skills.map((s) => s.name);
  const out: Record<string, number> = {};
  const level = new RegExp(`^\\W*(${NUM}|MAX)\\W*(?:/\\W*${NUM})?\\W*$`, "i");
  const inline = new RegExp(`(${NUM}|MAX)\\s*(?:/\\s*(${NUM}))?\\s*$`, "i");
  for (const line of lines) {
    const text = line.text.trim();
    const inl = inline.exec(text);
    const namePart = inl && inl.index > 0 ? text.slice(0, inl.index).trim() : text;
    if (namePart.length < 3) continue;
    const name = matchName(namePart, names);
    if (!name) continue;
    const def = skills.find((s) => s.name === name)!;
    let raw: string | null = inl?.[1] ?? null;
    if (raw === null) {
      const r = rightOf(line, lines).find((o) => level.test(o.text));
      raw = r ? level.exec(r.text)![1]! : null;
    }
    if (raw === null) continue;
    const v = /^max$/i.test(raw) ? def.maxLevel : num(raw);
    if (Number.isInteger(v) && v >= 0 && v <= def.maxLevel) out[def.id] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Only the fields that differ from the profile (so an unchanged window doesn't cause a save). */
export function statsChanges(p: Profile, read: StatsRead): StatsRead | null {
  const stats: StatsRead["stats"] = {};
  const combat: StatsRead["combat"] = {};
  for (const [k, v] of Object.entries(read.stats) as [keyof StatsRead["stats"], number][]) if (p.stats[k] !== v) stats[k] = v;
  for (const [k, v] of Object.entries(read.combat) as [keyof StatsRead["combat"], number][]) if (p.combat[k] !== v) combat[k] = v;
  return Object.keys(stats).length + Object.keys(combat).length > 0 ? { stats, combat } : null;
}

export function describeStats(c: StatsRead): string {
  const parts = [
    ...Object.entries(c.stats).map(([k, v]) => `${k.toUpperCase()} ${v}`),
    ...(c.combat.damageMin !== undefined ? [`damage ${c.combat.damageMin}–${c.combat.damageMax}`] : []),
    ...(c.combat.accuracy !== undefined ? [`accuracy ${c.combat.accuracy}`] : []),
    ...(c.combat.avoid !== undefined ? [`avoid ${c.combat.avoid}`] : []),
  ];
  return parts.join(", ");
}

export type QuestDefLite = { id: string; name: string };
export type QuestsRead = { active: string[]; done: string[] };

/**
 * The Quest window: a tab heading ("In Progress" / "Completed" / "Available") with quest names listed below it.
 * Names are matched against the guide's quests; the heading nearest above a name decides which list it joins.
 * Null unless a heading and at least one known quest were seen.
 */
export function parseQuestWindow(lines: Line[], quests: QuestDefLite[]): QuestsRead | null {
  const heads = lines
    .map((l) => ({ l, kind: /in\s*progress/i.test(l.text) ? "active" : /completed/i.test(l.text) ? "done" : /available/i.test(l.text) ? "available" : null }))
    .filter((h): h is { l: Line; kind: "active" | "done" | "available" } => h.kind !== null);
  if (heads.length === 0) return null;
  const names = quests.map((q) => q.name);
  const out: QuestsRead = { active: [], done: [] };
  for (const line of lines) {
    const text = line.text.replace(/^\W+|\W+$/g, "").replace(/\s*\(\d+\)$/, "");
    if (text.length < 4 || heads.some((h) => h.l === line)) continue;
    const name = matchName(text, names);
    if (!name) continue;
    const id = quests.find((q) => q.name === name)!.id;
    // The heading above (smaller y) and horizontally overlapping this line's window column.
    const head = heads
      .filter((h) => h.l.y < line.y && Math.abs(h.l.x - line.x) < 400)
      .sort((a, b) => b.l.y - a.l.y)[0];
    if (!head || head.kind === "available") continue;
    if (!out[head.kind].includes(id)) out[head.kind].push(id);
  }
  return out.active.length + out.done.length > 0 ? out : null;
}
