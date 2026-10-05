import type { Pack } from "../data/pack";
import type { Item, TrainingSpot } from "../data/schema/pack";
import type { Profile } from "../data/schema/profile";
import { nearestTown } from "./route";
import { rateWeight, usableDrop } from "./rates";
import type { Danger, SpotEstimate } from "./estimate";
import type { SubscoreKey } from "./weights";

// Plan §8.7 step 3. Raw values are normalised by the best candidate; safety/convenience are absolute 0…1 (§15).

export type RawSubscores = Record<SubscoreKey, number> & {
  /** Best contributing items, for reasons and "notable drops". */
  topDropItem: string | null;
  topEquipItem: string | null;
  town: { mapId: string; hops: number } | null;
};

export const SAFETY: Record<Danger, number> = { safe: 1, caution: 0.6, unknown: 0.6, dangerous: 0.15 };

export function jobFamily(pack: Pack, profile: Profile) {
  return pack.jobs.find((j) => j.id === profile.jobId)?.family ?? "beginner";
}

/** Equip in the character's upgrade window: reqJobs empty or includes the family; reqLevel ∈ [level, level+10]. */
export function isClassEquip(item: Item, family: string, level: number): boolean {
  if (item.category !== "equip" || item.reqLevel === undefined) return false;
  const jobsOk = !item.reqJobs?.length || item.reqJobs.includes(family as never);
  return jobsOk && item.reqLevel >= level && item.reqLevel <= level + 10;
}

export function rawSubscores(pack: Pack, profile: Profile, spot: TrainingSpot, est: SpotEstimate): RawSubscores {
  const family = jobFamily(pack, profile);
  const wishlist = new Set(profile.wishlistItemIds);
  let drop = 0;
  let equip = 0;
  const dropBest = new Map<string, number>();
  const equipBest = new Map<string, number>();
  for (const m of est.mobs) {
    for (const d of (pack.index.dropsByMob.get(m.mob.id) ?? []).filter(usableDrop)) {
      const item = pack.index.itemById.get(d.itemId);
      if (!item) continue;
      const w = rateWeight(d, pack.formulas);
      const rare = item.rarity === "rare" || item.rarity === "very-rare";
      if (rare || wishlist.has(item.id)) {
        const desirability = (item.rarity === "very-rare" ? 2 : 1) * (wishlist.has(item.id) ? 3 : 1);
        const v = m.weight * w * desirability;
        drop += v;
        dropBest.set(item.id, (dropBest.get(item.id) ?? 0) + v);
      }
      if (isClassEquip(item, family, profile.level)) {
        const v = m.weight * w;
        equip += v;
        equipBest.set(item.id, (equipBest.get(item.id) ?? 0) + v);
      }
    }
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const town = nearestTown(pack, spot.mapId);
  return {
    exp: est.kph * est.expPerKill,
    meso: est.kph * (est.mesoPerKill ?? 0),
    drop,
    equip,
    safety: SAFETY[est.estimate.danger],
    convenience: town ? 1 - Math.min(town.hops, 8) / 8 : 0.5,
    topDropItem: top(dropBest),
    topEquipItem: top(equipBest),
    town,
  };
}

const NORMALISED: SubscoreKey[] = ["exp", "meso", "drop", "equip"];

/** Scales exp/meso/drop/equip so the best candidate is 1 (all 0 when the max is 0). */
export function normalise(raws: RawSubscores[]): Record<SubscoreKey, number>[] {
  const max = Object.fromEntries(NORMALISED.map((k) => [k, Math.max(0, ...raws.map((r) => r[k]))])) as Record<SubscoreKey, number>;
  return raws.map((r) => ({
    exp: max.exp > 0 ? r.exp / max.exp : 0,
    meso: max.meso > 0 ? r.meso / max.meso : 0,
    drop: max.drop > 0 ? r.drop / max.drop : 0,
    equip: max.equip > 0 ? r.equip / max.equip : 0,
    safety: r.safety,
    convenience: r.convenience,
  }));
}
