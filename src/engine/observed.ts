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
