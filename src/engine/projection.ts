// I-20 Projections — pure maths behind the interactive graphs. Every input is either measured by the player,
// computed by the engine from their own combat stats, or an explicit "what if" the player sets.

export type Point = { x: number; y: number };

/** Hours to finish the current level from `expPercent` at a pace of `percentPerHour`. */
export function hoursToLevel(expPercent: number, percentPerHour: number): number | null {
  if (!(percentPerHour > 0)) return null;
  return Math.max(0, 100 - expPercent) / percentPerHour;
}

/** Pace (% of the level per hour) from a timed session: EXP% before/after (after may wrap past a level-up). */
export function paceFromSession(before: number, after: number, minutes: number, levelsGained = 0): number | null {
  if (!(minutes > 0)) return null;
  const gained = levelsGained * 100 + after - before;
  return gained > 0 ? (gained / minutes) * 60 : null;
}

/**
 * Level-by-level timeline when the EXP table is known: returns [hour, level-with-fraction] points.
 * `expToNext[level]` is EXP needed to go from `level` to `level+1`.
 */
export function levelTimeline(opts: {
  level: number;
  expPercent: number;
  expPerHour: number;
  expToNext: number[];
  hours: number;
  cap: number;
  step?: number;
}): Point[] {
  const { expPerHour, expToNext, hours, cap } = opts;
  const step = opts.step ?? Math.max(0.25, hours / 120);
  let level = opts.level;
  let into = ((expToNext[level] ?? 0) * opts.expPercent) / 100;
  const pts: Point[] = [{ x: 0, y: level + opts.expPercent / 100 }];
  if (!(expPerHour > 0)) return pts;
  for (let t = step; t <= hours + 1e-9 && level < cap; t += step) {
    into += expPerHour * step;
    while (level < cap && (expToNext[level] ?? 0) > 0 && into >= expToNext[level]!) {
      into -= expToNext[level]!;
      level++;
    }
    const need = expToNext[level] ?? 0;
    pts.push({ x: t, y: level >= cap || need <= 0 ? level : level + into / need });
  }
  return pts;
}

/** Cumulative meso over time for a low/high hourly range. */
export function mesoSeries(low: number, high: number, hours: number, steps = 24): { x: number; low: number; high: number }[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = (hours * i) / steps;
    return { x, low: low * x, high: high * x };
  });
}

/** Chance of at least one drop in `kills` kills at per-kill probability `p`. */
export function dropChance(p: number, kills: number): number {
  if (!(p > 0)) return 0;
  if (p >= 1) return kills > 0 ? 1 : 0;
  return 1 - Math.pow(1 - p, Math.max(0, kills));
}

/** Kills needed for a `target` (0–1) chance of at least one drop. */
export function killsForChance(p: number, target: number): number | null {
  if (!(p > 0) || !(target > 0) || target >= 1) return null;
  if (p >= 1) return 1;
  return Math.ceil(Math.log(1 - target) / Math.log(1 - p));
}

/** Formats hours as "2 h 15 min" / "45 min" / "3 d 4 h". */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours)) return "—";
  const totalMin = Math.round(hours * 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d} d ${hh} h` : `${d} d`;
}
