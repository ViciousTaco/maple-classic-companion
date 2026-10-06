import type { Pack } from "../../data/pack";
import type { Observation } from "../../data/schema/profile";

// I-29: a watching session at one spot, and the per-character totals it adds up to.

export type SessionTotals = {
  spotId: string | null;
  mapId: string | null;
  startedAt: string;
  /** Time spent actually training: gaps between reads count only while the EXP bar keeps rising (idle/town time doesn't). */
  activeMs: number;
  /** When the EXP bar last rose (named for kills, which is what raises it). */
  lastKillAt: number | null;
  /** Kills: estimated from EXP on guide maps (`killsFromExp`). Meso and items came from the old chat reader (I-50,
   * removed 2026-10-07) and stay 0; kept so saved data still loads. */
  kills: number;
  exp: number;
  meso: number;
  /** Kills per monster id ("?" when the EXP amount didn't identify one monster). */
  killsByMob: Record<string, number>;
  /** Item pickups by item id (unknown names under "?:<name>"). */
  items: Record<string, number>;
  startLevel: number | null;
  startExp: number | null;
  lastLevel: number | null;
  lastExp: number | null;
};

export function newSession(spotId: string | null, mapId: string | null, now: Date): SessionTotals {
  return { spotId, mapId, startedAt: now.toISOString(), activeMs: 0, lastKillAt: null, kills: 0, exp: 0, meso: 0, killsByMob: {}, items: {}, startLevel: null, startExp: null, lastLevel: null, lastExp: null };
}

/**
 * Kills estimated from EXP gained: EXP ÷ the map's average monster EXP (weighted by how many spawn). Classic monsters
 * give fixed EXP, so on a guide map this is close; null when the map or its monsters' EXP aren't in the guide.
 */
export function killsFromExp(pack: Pack, mapId: string | null, exp: number): number | null {
  const map = mapId ? pack.index.mapById.get(mapId) : undefined;
  const mobs = (map?.spawns ?? []).map((sp) => ({ n: sp.count ?? 1, exp: pack.index.monsterById.get(sp.mobId)?.exp ?? 0 })).filter((m) => m.exp > 0);
  if (mobs.length === 0 || exp <= 0) return null;
  const perKill = mobs.reduce((a, m) => a + m.n * m.exp, 0) / mobs.reduce((a, m) => a + m.n, 0);
  return Math.round(exp / perKill);
}

/** EXP gained within this long counts the time since the previous read as training time. */
export const ACTIVE_WINDOW_MS = 60_000;

export function applyStatus(t: SessionTotals, level: number | null, exp: number | null): SessionTotals {
  if (level === null && exp === null) return t;
  return {
    ...t,
    startLevel: t.startLevel ?? level,
    startExp: t.startExp ?? exp,
    lastLevel: level ?? t.lastLevel,
    lastExp: exp ?? t.lastExp,
  };
}

/** % of a level gained during the session from the status bar (handles level-ups), or null. */
export function percentGained(t: SessionTotals): number | null {
  if (t.startLevel === null || t.startExp === null || t.lastLevel === null || t.lastExp === null) return null;
  const g = (t.lastLevel - t.startLevel) * 100 + t.lastExp - t.startExp;
  return g >= 0 ? g : null;
}

/** Adds the time since the previous read (capped, so a sleep/suspend doesn't count) when kills are recent. */
export function tick(t: SessionTotals, dtMs: number, nowMs: number): SessionTotals {
  if (t.lastKillAt === null || nowMs - t.lastKillAt > ACTIVE_WINDOW_MS) return t;
  return { ...t, activeMs: t.activeMs + Math.min(Math.max(0, dtMs), 10_000) };
}

const add = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
};

/** Observations are keyed by training spot, or by `map:<id>` on a map the guide has no spot for. */
export function observationKey(spotId: string | null, mapId: string | null): string | null {
  return spotId ?? (mapId ? `map:${mapId}` : null);
}

/**
 * Folds a session's totals into the character's per-spot totals. Sessions with no kills change nothing.
 * `countSession` is false for later checkpoints of the same watching run, so "sessions" counts runs.
 */
export function mergeSession(observations: Record<string, Observation>, s: SessionTotals, now: Date, countSession = true): Record<string, Observation> {
  const key = observationKey(s.spotId, s.mapId);
  if (!key || (s.exp <= 0 && (percentGained(s) ?? 0) <= 0)) return observations;
  const prev = observations[key];
  const minutes = s.activeMs / 60_000;
  const pct = percentGained(s);
  return {
    ...observations,
    [key]: {
      minutes: (prev?.minutes ?? 0) + minutes,
      kills: (prev?.kills ?? 0) + s.kills,
      exp: (prev?.exp ?? 0) + s.exp,
      meso: (prev?.meso ?? 0) + s.meso,
      killsByMob: add(prev?.killsByMob ?? {}, s.killsByMob),
      items: add(prev?.items ?? {}, s.items),
      levelPercent: (prev?.levelPercent ?? 0) + (pct ?? 0),
      levelPercentMinutes: (prev?.levelPercentMinutes ?? 0) + (pct === null ? 0 : minutes),
      sessions: (prev?.sessions ?? 0) + (countSession ? 1 : 0),
      lastAt: now.toISOString(),
    },
  };
}
