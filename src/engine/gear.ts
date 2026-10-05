import type { Pack } from "../data/pack";
import type { Item } from "../data/schema/pack";
import type { Profile } from "../data/schema/profile";
import { findDropSources, type DropSource } from "./loot";
import { isClassEquip, jobFamily } from "./subscores";

// Plan P4-T6.

export type Upgrade = { slot: string; item: Item; level: number; how: string[]; note?: string; sources: DropSource[]; derived?: boolean };

/** Per slot, the next gear-progression item at or above the character's level, for their family (or "any"). */
export function nextUpgrades(profile: Profile, pack: Pack, limit = 5): Upgrade[] {
  const family = jobFamily(pack, profile);
  const bySlot = new Map<string, Upgrade>();
  for (const e of pack.gearProgression) {
    if (e.family !== family && e.family !== "any") continue;
    if (e.level < profile.level) continue;
    const item = pack.index.itemById.get(e.itemId);
    if (!item) continue;
    const cur = bySlot.get(e.slot);
    if (!cur || e.level < cur.level || (e.level === cur.level && e.itemId < cur.item.id)) {
      bySlot.set(e.slot, { slot: e.slot, item, level: e.level, how: e.how, ...(e.note ? { note: e.note } : {}), sources: findDropSources(pack, e.itemId) });
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
      if (!cur || item.reqLevel! < cur.level || (item.reqLevel === cur.level && item.id < cur.item.id))
        bySlot.set(item.slot, { slot: item.slot, item, level: item.reqLevel!, how: ["drop"], sources, derived: true });
    }
  }
  return [...bySlot.values()].sort((a, b) => a.level - b.level || a.slot.localeCompare(b.slot)).slice(0, limit);
}
