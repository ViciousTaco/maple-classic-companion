import type { FocusId } from "../data/schema/profile";
import type { Confidence } from "../data/schema/pack";

// Plan §8.7 (binding).

export type SubscoreKey = "exp" | "meso" | "drop" | "equip" | "safety" | "convenience";
export const SUBSCORE_KEYS: SubscoreKey[] = ["exp", "meso", "drop", "equip", "safety", "convenience"];

export const DEFAULT_FOCUS_WEIGHTS: Record<FocusId, Record<SubscoreKey, number>> = {
  exp: { exp: 0.65, meso: 0.05, drop: 0.05, equip: 0.05, safety: 0.12, convenience: 0.08 },
  "rare-drop": { exp: 0.15, meso: 0.05, drop: 0.55, equip: 0.05, safety: 0.12, convenience: 0.08 },
  "class-equip": { exp: 0.15, meso: 0.05, drop: 0.05, equip: 0.55, safety: 0.12, convenience: 0.08 },
  meso: { exp: 0.15, meso: 0.55, drop: 0.1, equip: 0.0, safety: 0.12, convenience: 0.08 },
  balanced: { exp: 0.3, meso: 0.18, drop: 0.16, equip: 0.16, safety: 0.12, convenience: 0.08 },
}; // each row sums to 1.00; datapack `focus-profiles.json` may override

export function bandFit(level: number, min: number, max: number): number {
  if (level >= min && level <= max) return 1;
  if (level < min) return Math.max(0, 1 - (min - level) / 3); // 0 at min-3
  return Math.max(0, 1 - (level - max) / 5); // 0 at max+5
}

/** Relaxed fit for stretch backups (plan §8.7 step 5): 0 at min−5 / max+8. */
export function relaxedFit(level: number, min: number, max: number): number {
  if (level >= min && level <= max) return 1;
  if (level < min) return Math.max(0, 1 - (min - level) / 5);
  return Math.max(0, 1 - (level - max) / 8);
}

export function finalScore(
  sub: Record<SubscoreKey, number>,
  w: Record<SubscoreKey, number>,
  fit: number,
  confidence: Confidence,
): number {
  const conf = { verified: 1, likely: 0.95, unverified: 0.85 }[confidence];
  const base = (Object.keys(w) as SubscoreKey[]).reduce((s, k) => s + w[k] * sub[k], 0);
  return base * fit * conf;
}

/**
 * Primary + backups. The primary is the best spot whose level band includes the player (`fit` 1) whenever there is
 * one, so a spot is dropped as soon as the player outgrows it, however good its drops (owner, 2026-10-07: "the
 * training spots do not update when I level up" — Lv 11 kept a Lv 4–10 spot). Near-band spots stay as backups.
 */
export function pickPlan<T extends { score: number; mapId: string; fit?: number }>(ranked: T[], maxBackups = 3) {
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const primary = sorted.find((c) => c.fit === undefined || c.fit >= 1) ?? sorted[0] ?? null;
  const used = new Set<string>(primary ? [primary.mapId] : []);
  const backups: T[] = [];
  for (const c of sorted.slice(1)) {
    if (backups.length >= maxBackups) break;
    if (used.has(c.mapId)) continue; // a backup must be a different map
    used.add(c.mapId);
    backups.push(c);
  }
  return { primary, backups };
}
