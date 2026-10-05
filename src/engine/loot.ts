import type { Pack } from "../data/pack";
import type { Drop, Item, Monster } from "../data/schema/pack";
import type { Profile } from "../data/schema/profile";
import { rateLabel, rateWeight, usableDrop } from "./rates";
import { isClassEquip, jobFamily } from "./subscores";

// Plan P4-T5.

export type DropSource = { mob: Monster; drop: Drop; label: string; mapIds: string[]; spotIds: string[] };

/** Where an item drops, best-ranked first (higher rate weight, then lower monster level). */
export function findDropSources(pack: Pack, itemId: string): DropSource[] {
  return (pack.index.dropsByItem.get(itemId) ?? [])
    .filter(usableDrop)
    .map((drop) => {
      const mob = pack.index.monsterById.get(drop.mobId);
      if (!mob) return null;
      const mapIds = pack.maps.filter((m) => m.spawns.some((s) => s.mobId === mob.id)).map((m) => m.id);
      const spotIds = pack.trainingSpots.filter((s) => s.mobIds.includes(mob.id)).map((s) => s.id);
      return { mob, drop, label: rateLabel(drop), mapIds, spotIds };
    })
    .filter((x): x is DropSource => x !== null)
    .sort((a, b) => rateWeight(b.drop, pack.formulas) - rateWeight(a.drop, pack.formulas) || a.mob.level - b.mob.level || a.mob.id.localeCompare(b.mob.id));
}

export type LootTarget = { item: Item; desirability: number; why: "wishlist" | "class-equip" | "rare"; sources: DropSource[] };

/** Items worth hunting now: dropped by monsters at most 5 levels above the character, ranked by desirability. */
export function bestLootTargets(profile: Profile, pack: Pack, limit = 3): LootTarget[] {
  const family = jobFamily(pack, profile);
  const wish = new Set(profile.wishlistItemIds);
  const out: LootTarget[] = [];
  for (const item of pack.items) {
    const sources = findDropSources(pack, item.id).filter((s) => s.mob.level <= profile.level + 5);
    if (!sources.length) continue;
    const classEquip = isClassEquip(item, family, profile.level);
    const rare = item.rarity === "rare" || item.rarity === "very-rare";
    if (!wish.has(item.id) && !classEquip && !rare) continue;
    const desirability = (wish.has(item.id) ? 3 : 1) * (classEquip ? 2 : 1) * (item.rarity === "very-rare" ? 2 : 1);
    out.push({ item, desirability, why: wish.has(item.id) ? "wishlist" : classEquip ? "class-equip" : "rare", sources });
  }
  const whyOrder = { wishlist: 0, "class-equip": 1, rare: 2 } as const;
  return out
    .sort(
      (a, b) =>
        b.desirability - a.desirability ||
        whyOrder[a.why] - whyOrder[b.why] ||
        (a.item.reqLevel ?? 0) - (b.item.reqLevel ?? 0) ||
        a.item.id.localeCompare(b.item.id),
    )
    .slice(0, limit);
}
