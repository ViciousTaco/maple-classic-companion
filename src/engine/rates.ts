import type { Drop, Formulas } from "../data/schema/pack";

/** Internal ranking weight for a drop (plan §8.7 `w(rate)`). Never displayed as a rate (§6.3). */
export function rateWeight(drop: Drop, formulas: Formulas): number {
  switch (drop.rate.kind) {
    case "exact":
      return drop.rate.pct / 100;
    case "sampled":
      return drop.rate.drops / drop.rate.kills;
    case "tier":
      return formulas.tierWeights[drop.rate.tier];
    case "unknown":
      return formulas.tierWeights.unknown;
  }
}

/** A real probability for projections — only from official or sampled rates (§6.3). */
export function knownProbability(drop: Drop): { p: number; basis: "official" | "sampled"; sample?: { drops: number; kills: number } } | null {
  if (drop.rate.kind === "exact") return { p: drop.rate.pct / 100, basis: "official" };
  if (drop.rate.kind === "sampled" && drop.rate.kills > 0)
    return { p: drop.rate.drops / drop.rate.kills, basis: "sampled", sample: { drops: drop.rate.drops, kills: drop.rate.kills } };
  return null;
}

/** What the UI shows for a drop rate (plan §6.3). */
export function rateLabel(drop: Drop): string {
  const r = drop.rate;
  switch (r.kind) {
    case "exact":
      return `${r.pct}% (official)`;
    case "sampled":
      return `Seen ${r.drops.toLocaleString("en-AU")} time${r.drops === 1 ? "" : "s"} in ${r.kills.toLocaleString("en-AU")} kills`;
    case "tier":
      return { common: "Common", uncommon: "Uncommon", rare: "Rare", "very-rare": "Very rare" }[r.tier];
    case "unknown":
      return `${drop.status === "confirmed" ? "Confirmed" : "Reported"} drop · rate not known yet`;
  }
}

export const usableDrop = (d: Drop) => d.status !== "legacy-unverified";

/** I-35: "You: 3 in 240 kills" — the owner's own pickups per kill, from the screen watcher. */
export function ownRateLabel(r: { drops: number; kills: number } | null): string | null {
  return r ? `You: ${r.drops.toLocaleString("en-AU")} in ${r.kills.toLocaleString("en-AU")} kills` : null;
}
