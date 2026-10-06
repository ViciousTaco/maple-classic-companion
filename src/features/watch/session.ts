import type { Pack } from "../../data/pack";
import type { Observation } from "../../data/schema/profile";
import type { ChatEvent } from "./parse";
import { matchName } from "./parse";

// I-29: a watching session at one spot, and the per-character totals it adds up to.

export type SessionTotals = {
  spotId: string | null;
  mapId: string | null;
  startedAt: string;
  /** Time spent actually training: gaps between reads count only while kills keep coming (idle/town time doesn't). */
  activeMs: number;
  lastKillAt: number | null;
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

/** Which monster an EXP gain came from: the unique monster on this map with exactly that EXP, else "?". */
export function monsterForExp(pack: Pack, mapId: string | null, amount: number): string {
  const map = mapId ? pack.index.mapById.get(mapId) : undefined;
  const candidates = (map?.spawns ?? []).map((s) => pack.index.monsterById.get(s.mobId)).filter((m) => m && m.exp === amount);
  return candidates.length === 1 ? candidates[0]!.id : "?";
}

/** A kill within this long counts the time since the previous read as training time. */
export const ACTIVE_WINDOW_MS = 60_000;

export function applyEvents(t: SessionTotals, events: ChatEvent[], pack: Pack, nowMs = Date.now()): SessionTotals {
  const next = { ...t, killsByMob: { ...t.killsByMob }, items: { ...t.items } };
  if (events.some((e) => e.kind === "exp")) next.lastKillAt = nowMs;
  const itemNames = pack.items.map((i) => i.name);
  for (const e of events) {
    if (e.kind === "exp") {
      next.kills += 1;
      next.exp += e.amount;
      const mob = monsterForExp(pack, t.mapId, e.amount);
      next.killsByMob[mob] = (next.killsByMob[mob] ?? 0) + 1;
    } else if (e.kind === "meso") {
      next.meso += e.amount;
    } else {
      const name = matchName(e.name, itemNames);
      const id = name ? pack.items.find((i) => i.name === name)!.id : `?:${e.name}`;
      next.items[id] = (next.items[id] ?? 0) + 1;
    }
  }
  return next;
}

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
  if (!key || s.kills === 0) return observations;
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
