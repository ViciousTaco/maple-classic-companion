import type { Pack } from "../../data/pack";
import type { Confidence } from "../../data/schema/pack";
import type { Range } from "../../engine/estimate";
import type { Reason } from "../../engine/reasons";

// Plain-words copy for engine output (plan P9-T5: "spot / map / monster", no jargon).

export const mapName = (pack: Pack, id: string) => pack.index.mapById.get(id)?.name ?? id;
export const mobName = (pack: Pack, id: string) => pack.index.monsterById.get(id)?.name ?? id;
export const itemName = (pack: Pack, id: string) => pack.index.itemById.get(id)?.name ?? id;
export const regionName = (pack: Pack, id: string) => pack.unlockables.regions.find((r) => r.id === id)?.name ?? id;

export function reasonText(pack: Pack, r: Reason): string {
  const p = r.params;
  switch (r.code) {
    case "best-exp":
      return p.rank === 1 ? `Best EXP of ${p.of} spot${p.of === 1 ? "" : "s"} for your level` : `#${p.rank} for EXP out of ${p.of} spots`;
    case "good-meso":
      return p.rank === 1 ? `Most meso of ${p.of} spots` : `#${p.rank} for meso out of ${p.of} spots`;
    case "drops-rare":
      return `Can drop ${itemName(pack, String(p.itemId))}`;
    case "drops-class-equip":
      return `Drops ${itemName(pack, String(p.itemId))} for your class`;
    case "safe":
      return "Monsters here can't hurt you much";
    case "near-town":
      return p.hops === 0 ? `Right in ${mapName(pack, String(p.mapId))}` : `${p.hops} map${p.hops === 1 ? "" : "s"} from ${mapName(pack, String(p.mapId))}`;
    default:
      return r.code;
  }
}

export function warningText(r: Reason): string {
  switch (r.code) {
    case "dangerous-mob":
      return "Monsters here hit hard for your HP — bring potions.";
    case "hit-chance-assumed":
      return "Hit chance is assumed (Classic World's accuracy formula isn't confirmed yet).";
    case "estimate-assumptions":
      return "Rates assume ~0.8 s per attack and ~1.5 s walking per kill — measure your real pace on the Plan screen.";
    case "estimate-from-level-only":
      return "Ranked by level and spawns only — add your damage range for EXP/hour.";
    case "unverified-data":
      return "Some of this spot's data is unconfirmed.";
    case "stretch-option":
      return "A stretch: a little outside your level range.";
    default:
      return r.code;
  }
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  verified: "Verified",
  likely: "Likely",
  unverified: "Unconfirmed",
};

const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString("en-AU"));
export const rangeText = (r: Range | null) => (r ? `${fmt(r.low)}–${fmt(r.high)}` : "—");
export const midOf = (r: Range | null) => (r ? (r.low + r.high) / 2 : null);

/** Exact MeowDB link from a recorded id only (link accuracy rule §6.1). */
export function meowdbUrl(kind: "monster" | "map" | "item" | "quest", id: string | undefined): string | null {
  if (!id || !/^[0-9]{1,12}$/.test(id)) return null;
  const path = { monster: "monsters", map: "maps", item: "item-db", quest: "quest-tracker" }[kind];
  return `https://meowdb.com/msclassic/${path}/${id}`;
}

/** Stable pleasant hue triple for a map's illustrated tile (original art, no game assets). */
export function sceneHue(id: string): [string, string, string] {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const palettes: [string, string, string][] = [
    ["#ffcf8a", "#ff8f5a", "#7cc58a"],
    ["#c6f0b8", "#58b36b", "#2f6f4f"],
    ["#b9dcff", "#6aa8ff", "#ffb6a1"],
    ["#ffd2a6", "#ff7a45", "#8a4b2a"],
    ["#e4d4ff", "#9d7bff", "#5b4a9e"],
    ["#ffe6a3", "#ffc04d", "#c27a2c"],
    ["#c8f1ee", "#4fbfb4", "#2a6f6a"],
  ];
  return palettes[h % palettes.length]!;
}
