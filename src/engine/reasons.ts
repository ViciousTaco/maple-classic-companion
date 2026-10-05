import type { Confidence } from "../data/schema/pack";
import type { SpotEstimate } from "./estimate";
import type { RawSubscores } from "./subscores";
import type { SubscoreKey } from "./weights";

// Plan §8.7 step 6.

export type Reason = { code: string; params: Record<string, string | number> };

export function reasonsFor(args: {
  sub: Record<SubscoreKey, number>;
  self: Record<SubscoreKey, number>;
  all: Record<SubscoreKey, number>[];
  weights: Record<SubscoreKey, number>;
  raw: RawSubscores;
}): Reason[] {
  const { sub, all, weights, raw } = args;
  const rank = (k: SubscoreKey) => 1 + all.filter((o) => o[k] > sub[k] + 1e-12).length;
  const contributions = (Object.keys(weights) as SubscoreKey[])
    .map((k) => ({ k, v: weights[k] * sub[k] }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || a.k.localeCompare(b.k));
  const out: Reason[] = [];
  for (const { k } of contributions) {
    if (out.length >= 3) break;
    switch (k) {
      case "exp":
        out.push({ code: "best-exp", params: { rank: rank("exp"), of: all.length } });
        break;
      case "meso":
        out.push({ code: "good-meso", params: { rank: rank("meso"), of: all.length } });
        break;
      case "drop":
        if (raw.topDropItem) out.push({ code: "drops-rare", params: { itemId: raw.topDropItem } });
        break;
      case "equip":
        if (raw.topEquipItem) out.push({ code: "drops-class-equip", params: { itemId: raw.topEquipItem } });
        break;
      case "safety":
        if (sub.safety >= 1) out.push({ code: "safe", params: {} });
        break;
      case "convenience":
        if (raw.town) out.push({ code: "near-town", params: { mapId: raw.town.mapId, hops: raw.town.hops } });
        break;
    }
  }
  return out;
}

export function warningsFor(args: { est: SpotEstimate; stretch: boolean; confidence: Confidence }): Reason[] {
  const w: Reason[] = [];
  if (args.est.estimate.danger === "dangerous") w.push({ code: "dangerous-mob", params: {} });
  if (args.est.estimate.basis === "computed" && args.est.hitChanceAssumed) w.push({ code: "hit-chance-assumed", params: {} });
  if (args.est.estimate.basis === "level-band") w.push({ code: "estimate-from-level-only", params: {} });
  if (args.confidence === "unverified") w.push({ code: "unverified-data", params: {} });
  if (args.stretch) w.push({ code: "stretch-option", params: {} });
  return w;
}
