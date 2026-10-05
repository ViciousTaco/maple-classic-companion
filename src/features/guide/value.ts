import type { Pack } from "../../data/pack";
import type { Item, Quest } from "../../data/schema/pack";

// Gold / Silver / Bronze highlighting for drops (owner request 2026-10-06). Based only on what's known:
// NPC sell price (relative to every priced item in the guide) and the item's recorded rarity.
// Player-market prices aren't tracked anywhere official, so they're not used.

export type ValueTier = "gold" | "silver" | "bronze" | null;

const thresholds = new WeakMap<Pack, { gold: number; silver: number; bronze: number }>();

function priceThresholds(pack: Pack) {
  let t = thresholds.get(pack);
  if (!t) {
    const prices = pack.items.map((i) => i.npcSellMeso).filter((p): p is number => typeof p === "number" && p > 0).sort((a, b) => b - a);
    const at = (q: number) => prices[Math.max(0, Math.ceil(prices.length * q) - 1)] ?? Infinity;
    t = prices.length >= 10 ? { gold: at(0.1), silver: at(0.25), bronze: at(0.5) } : { gold: Infinity, silver: Infinity, bronze: Infinity };
    thresholds.set(pack, t);
  }
  return t;
}

export function valueTier(item: Item, pack: Pack): ValueTier {
  const t = priceThresholds(pack);
  const p = item.npcSellMeso ?? 0;
  if (item.rarity === "very-rare" || p >= t.gold) return "gold";
  if (item.rarity === "rare" || p >= t.silver) return "silver";
  if (p > 0 && p >= t.bronze) return "bronze";
  return null;
}

export const TIER_ORDER: Record<string, number> = { gold: 0, silver: 1, bronze: 2, none: 3 };

export const TIER_STYLE: Record<Exclude<ValueTier, null>, { label: string; row: string; chip: string }> = {
  gold: {
    label: "Gold",
    row: "bg-[linear-gradient(90deg,rgb(255_196_40/0.28),rgb(255_196_40/0.06))] ring-1 ring-[rgb(230_170_20/0.55)]",
    chip: "bg-[#f5c518] text-[#3d2c00]",
  },
  silver: {
    label: "Silver",
    row: "bg-[linear-gradient(90deg,rgb(190_200_212/0.32),rgb(190_200_212/0.07))] ring-1 ring-[rgb(160_172_186/0.6)]",
    chip: "bg-[#c9d1da] text-[#1f2933]",
  },
  bronze: {
    label: "Bronze",
    row: "bg-[linear-gradient(90deg,rgb(205_127_50/0.26),rgb(205_127_50/0.06))] ring-1 ring-[rgb(190_115_45/0.5)]",
    chip: "bg-[#d08a4a] text-[#2b1606]",
  },
};

/** Quests that need this item (a collect/deliver step), for "Needed for …" chips. */
export function questUses(itemId: string, pack: Pack): Quest[] {
  return pack.quests.filter((q) => q.steps.some((s) => s.itemId === itemId && (s.kind === "collect" || s.kind === "deliver")));
}
