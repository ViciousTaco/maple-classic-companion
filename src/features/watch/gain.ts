// EXP gained, from the EXP number on the bar alone (owner, 2026-10-07: the EXP messages fly past faster than any read
// can catch, so they're not used). Each good reading of the bar is a sample; what was gained is the difference
// between the first and the latest sample at a level — so a misread in between never adds up — plus whatever
// finished levels contributed. A drop (death penalty) is not "gained" and is not taken off either; a small dip
// (under 1 % of the level) is a misread, not a death, and is ignored.

/** One good reading of the bar: level, EXP % and (when readable) the EXP number. */
export type ExpSample = { level: number; pct: number; total: number | null };

export type ExpMeter = {
  /** EXP from stretches that ended (a level-up or a drop). */
  banked: number;
  /** The current stretch: its first and latest samples, at one level. */
  first: ExpSample | null;
  last: ExpSample | null;
  /** EXP to the next level, per level — from the guide, or worked out from the bar (EXP number ÷ %, by the caller). */
  need: Record<number, number>;
};

export const newExpMeter = (need: Record<number, number> = {}): ExpMeter => ({ banked: 0, first: null, last: null, need: { ...need } });

/** EXP into the level a sample shows: the number itself, or the % of what the level needs. */
function into(m: ExpMeter, s: ExpSample): number | null {
  if (s.total !== null) return s.total;
  const need = m.need[s.level];
  return need ? (need * s.pct) / 100 : null;
}

/** EXP gained in the current stretch (null when it can't be told in EXP — the % alone, level not in the guide). */
function stretch(m: ExpMeter): number | null {
  if (!m.first || !m.last) return 0;
  const a = into(m, m.first);
  const b = into(m, m.last);
  return a === null || b === null ? null : Math.max(0, b - a);
}

/** EXP gained since the meter started, or null when the level's EXP size isn't known yet. */
export function expGained(m: ExpMeter): number | null {
  const s = stretch(m);
  return s === null ? null : Math.round(m.banked + s);
}

/** Folds a good reading in. */
export function addSample(m: ExpMeter, s: ExpSample): void {
  const last = m.last;
  if (!m.first || !last) {
    m.first = m.last = s;
    return;
  }
  const bank = (upTo: ExpSample) => {
    m.last = upTo;
    m.banked += stretch(m) ?? 0;
  };
  if (s.level === last.level + 1) {
    // Level-up: the rest of the old level, then a new stretch from the start of this one.
    const need = m.need[last.level];
    if (need) bank({ level: last.level, pct: 100, total: last.total !== null ? need : null });
    else bank(last);
    m.first = { level: s.level, pct: 0, total: s.total !== null ? 0 : null };
    m.last = s;
    return;
  }
  // A dip under 1 % of the level: a misread (a dropped decimal part, "72" for 72.687), not a death — ignored.
  if (s.level === last.level && s.pct < last.pct && last.pct - s.pct < 1) return;
  const a = into(m, last);
  const b = into(m, s);
  const dropped = s.level !== last.level || (a !== null && b !== null ? b < a : s.pct < last.pct);
  if (dropped) {
    // Death penalty, a misread level, a character change: keep what was gained, start a new stretch here.
    bank(last);
    m.first = m.last = s;
    return;
  }
  // The number became readable (or stopped being): restart the stretch on the same footing, keeping the gain.
  if ((m.first.total === null) !== (s.total === null) && !(m.need[s.level] ?? 0)) {
    bank(last);
    m.first = s;
  }
  m.last = s;
}
