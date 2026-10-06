import type { Pack } from "../data/pack";
import type { Observation } from "../data/schema/profile";
import type { Range } from "./estimate";

// I-29: rates measured by the screen watcher at a spot. Real numbers from the owner's own play, so they replace
// the engine's kills/hour guess when there's enough of them.

/** Enough watching to trust the numbers: 10 minutes and 30 kills. */
export const OBSERVED_MIN_MINUTES = 10;
export const OBSERVED_MIN_KILLS = 30;

export type ObservedRates = {
  minutes: number;
  kills: number;
  killsPerHour: Range;
  expPerHour: Range;
  /** Meso picked up + picked-up items at their NPC sell price (both seen, nothing guessed). */
  mesoPerHour: Range;
  /** % of a level per hour from the status bar, or null when it wasn't read. */
  percentPerHour: number | null;
};

const band = (v: number): Range => ({ low: v * 0.9, high: v * 1.1 });

export function observedRates(pack: Pack, obs: Observation | undefined): ObservedRates | null {
  if (!obs || obs.minutes < OBSERVED_MIN_MINUTES || obs.kills < OBSERVED_MIN_KILLS) return null;
  const h = obs.minutes / 60;
  let itemMeso = 0;
  for (const [id, n] of Object.entries(obs.items)) itemMeso += (pack.index.itemById.get(id)?.npcSellMeso ?? 0) * n;
  return {
    minutes: obs.minutes,
    kills: obs.kills,
    killsPerHour: band(obs.kills / h),
    expPerHour: band(obs.exp / h),
    mesoPerHour: band((obs.meso + itemMeso) / h),
    percentPerHour: obs.levelPercentMinutes >= OBSERVED_MIN_MINUTES ? (obs.levelPercent / obs.levelPercentMinutes) * 60 : null,
  };
}

/** Items the owner picked up at a spot, as "seen N times in K kills" (per kill at the spot, any monster). */
export function observedDrops(obs: Observation | undefined): { itemId: string; drops: number; kills: number }[] {
  if (!obs || obs.kills === 0) return [];
  return Object.entries(obs.items)
    .filter(([id]) => !id.startsWith("?:"))
    .map(([itemId, drops]) => ({ itemId, drops, kills: obs.kills }))
    .sort((a, b) => b.drops - a.drops || a.itemId.localeCompare(b.itemId));
}

/**
 * I-35: the owner's own drop rate for (monster, item), from watched spots where that monster is the only one on the
 * map that drops the item (so a pickup can be attributed). Pickups, not drops — the owner may leave things lying.
 */
export function ownDropRate(pack: Pack, observations: Record<string, Observation>, mobId: string, itemId: string): { drops: number; kills: number } | null {
  let drops = 0;
  let kills = 0;
  for (const [key, obs] of Object.entries(observations)) {
    const mapId = key.startsWith("map:") ? key.slice(4) : pack.index.spotById.get(key)?.mapId;
    const map = mapId ? pack.index.mapById.get(mapId) : undefined;
    if (!map || !map.spawns.some((s) => s.mobId === mobId)) continue;
    const droppers = map.spawns.filter((s) => (pack.index.dropsByMob.get(s.mobId) ?? []).some((d) => d.itemId === itemId)).map((s) => s.mobId);
    if (droppers.length !== 1 || droppers[0] !== mobId) continue;
    const k = obs.killsByMob[mobId] ?? 0;
    if (k === 0) continue;
    kills += k;
    drops += obs.items[itemId] ?? 0;
  }
  return kills >= 20 ? { drops, kills } : null;
}

/**
 * I-36: how the owner's measured kills/hour compare with the engine's computed prediction, as a single factor
 * (median over measured spots, clamped 0.5–2). Applied to unmeasured spots so estimates match how they actually play.
 */
export function paceFactor(pairs: { predicted: number; observed: number }[]): { factor: number; spots: number } | null {
  const ratios = pairs.filter((p) => p.predicted > 0 && p.observed > 0).map((p) => p.observed / p.predicted).sort((a, b) => a - b);
  if (ratios.length === 0) return null;
  const mid = ratios.length % 2 ? ratios[(ratios.length - 1) / 2]! : (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2;
  return { factor: Math.min(2, Math.max(0.5, mid)), spots: ratios.length };
}
