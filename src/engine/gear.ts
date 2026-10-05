import type { Pack } from "../data/pack";
import type { Item } from "../data/schema/pack";
import type { Profile } from "../data/schema/profile";
import { findDropSources, type DropSource } from "./loot";
import { isClassEquip, jobFamily } from "./subscores";

// Plan P4-T6.

export type Upgrade = {
  slot: string;
  item: Item;
  level: number;
  how: string[];
  note?: string;
  sources: DropSource[];
  derived?: boolean;
  /** False when the item's main stat requirement isn't the class's build stat (e.g. a STR sword for a LUK thief). */
  fitsBuild: boolean;
};

type Stat = "str" | "dex" | "int" | "luk";

/** An item fits a build when it has no stat requirement, or its biggest requirement is the build's main stat. */
export function fitsBuild(item: Item, primary: Stat | null): boolean {
  if (!primary || !item.reqStats) return true;
  const entries = Object.entries(item.reqStats).filter(([, v]) => (v ?? 0) > 0) as [Stat, number][];
  if (!entries.length) return true;
  const top = Math.max(...entries.map(([, v]) => v));
  return entries.some(([k, v]) => k === primary && v === top);
}

/** Per slot, the next gear-progression item at or above the character's level, for their family (or "any"). */
export function nextUpgrades(profile: Profile, pack: Pack, limit = 5, primary: Stat | null = null): Upgrade[] {
  const family = jobFamily(pack, profile);
  const bySlot = new Map<string, Upgrade>();
  for (const e of pack.gearProgression) {
    if (e.family !== family && e.family !== "any") continue;
    if (e.level < profile.level) continue;
    const item = pack.index.itemById.get(e.itemId);
    if (!item) continue;
    const cur = bySlot.get(e.slot);
    const fits = fitsBuild(item, primary);
    if (!cur || better(fits, e.level, item.id, cur)) {
      bySlot.set(e.slot, { slot: e.slot, item, level: e.level, how: e.how, ...(e.note ? { note: e.note } : {}), sources: findDropSources(pack, e.itemId), fitsBuild: fits });
    }
  }
  if (bySlot.size === 0) {
    // No curated progression for this family yet: derive it from item data — equips for the class within
    // 10 levels that a known monster drops (facts only; nothing ranked by guesswork).
    for (const item of pack.items) {
      if (!item.slot || !isClassEquip(item, family, profile.level)) continue;
      const sources = findDropSources(pack, item.id);
      if (!sources.length) continue;
      const cur = bySlot.get(item.slot);
      const fits = fitsBuild(item, primary);
      if (!cur || better(fits, item.reqLevel!, item.id, cur))
        bySlot.set(item.slot, { slot: item.slot, item, level: item.reqLevel!, how: ["drop"], sources, derived: true, fitsBuild: fits });
    }
  }
  return [...bySlot.values()].sort((a, b) => Number(b.fitsBuild) - Number(a.fitsBuild) || a.level - b.level || a.slot.localeCompare(b.slot)).slice(0, limit);
}

/** Build-matching items first, then the lower level, then id (deterministic). */
function better(fits: boolean, level: number, id: string, cur: Upgrade): boolean {
  if (fits !== cur.fitsBuild) return fits;
  return level < cur.level || (level === cur.level && id < cur.item.id);
}
