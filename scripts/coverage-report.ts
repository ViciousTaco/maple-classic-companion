// npm run datapack:coverage — what the guide data covers and where the gaps are (plan P3-T11).
import { resolve } from "node:path";
import type { PackData } from "../src/data/schema/pack";
import { parsePackFiles } from "../src/data/validate";
import { readSource } from "./lib/source";

export const ARCHETYPES = ["melee", "ranged", "mage"] as const;
export const TARGET_SPOTS = 2;
export const TARGET_MAX_LEVEL = 50;

export type Coverage = {
  bands: { min: number; max: number; spots: Record<(typeof ARCHETYPES)[number], number>; quests: number }[];
  confidence: Record<"verified" | "likely" | "unverified", number>;
  totals: Record<string, number>;
  gaps: string[];
};

export function coverage(pack: PackData): Coverage {
  const bands: Coverage["bands"] = [];
  for (let min = 1; min <= pack.meta.levelCap; min += 5) {
    const max = Math.min(min + 4, pack.meta.levelCap);
    const spots = { melee: 0, ranged: 0, mage: 0 };
    for (const s of pack.trainingSpots) {
      if (s.party === "party") continue; // listed separately; can't be a solo primary
      for (const a of ARCHETYPES)
        if (s.bands.some((b) => (b.archetype === a || b.archetype === "any") && b.min <= max && b.max >= min)) spots[a]++;
    }
    const quests = pack.quests.filter((q) => q.minLevel <= max && (q.maxLevel ?? pack.meta.levelCap) >= min).length;
    bands.push({ min, max, spots, quests });
  }

  const confidence = { verified: 0, likely: 0, unverified: 0 };
  const records = [pack.monsters, pack.maps, pack.items, pack.drops, pack.npcs, pack.quests, pack.trainingSpots, pack.skills, pack.events].flat();
  for (const r of records) confidence[r.confidence]++;

  const gaps: string[] = [];
  for (const b of bands.filter((x) => x.min <= TARGET_MAX_LEVEL))
    for (const a of ARCHETYPES)
      if (b.spots[a] < TARGET_SPOTS) gaps.push(`Lv ${b.min}–${b.max} ${a}: ${b.spots[a]} spot(s), need ${TARGET_SPOTS}`);
  if (pack.formulas.expToNext === null) gaps.push("EXP table (expToNext) unknown");
  if (pack.meta.defaultRespawnSec === null) gaps.push("default respawn time unknown");

  return {
    bands,
    confidence,
    totals: {
      monsters: pack.monsters.length,
      maps: pack.maps.length,
      items: pack.items.length,
      drops: pack.drops.length,
      npcs: pack.npcs.length,
      quests: pack.quests.length,
      spots: pack.trainingSpots.length,
      skills: pack.skills.length,
      events: pack.events.length,
      videos: pack.videos.length,
    },
    gaps,
  };
}

export function formatCoverage(c: Coverage, packVersion: string): string {
  const pct = (n: number) => {
    const total = c.confidence.verified + c.confidence.likely + c.confidence.unverified;
    return total ? `${Math.round((n / total) * 100)}%` : "–";
  };
  const lines = [
    `Coverage for ${packVersion}`,
    `Records: ${Object.entries(c.totals).map(([k, v]) => `${k} ${v}`).join(" · ")}`,
    `Confidence: verified ${pct(c.confidence.verified)} · likely ${pct(c.confidence.likely)} · unverified ${pct(c.confidence.unverified)}`,
    "",
    "Levels   | melee | ranged | mage | quests",
    ...c.bands
      .filter((b) => b.min <= TARGET_MAX_LEVEL || b.spots.melee + b.spots.ranged + b.spots.mage + b.quests > 0)
      .map((b) => `${`${b.min}–${b.max}`.padEnd(8)} | ${String(b.spots.melee).padStart(5)} | ${String(b.spots.ranged).padStart(6)} | ${String(b.spots.mage).padStart(4)} | ${String(b.quests).padStart(6)}`),
    "",
    `Gaps (${c.gaps.length}):`,
    ...c.gaps.slice(0, 40).map((g) => `  - ${g}`),
    ...(c.gaps.length > 40 ? [`  … and ${c.gaps.length - 40} more`] : []),
  ];
  return lines.join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const { raw } = readSource(resolve(process.argv[2] ?? "datapack"));
  const parsed = parsePackFiles(raw);
  if (!parsed.pack) {
    console.error("The datapack doesn't parse — run npm run datapack:validate first.");
    process.exit(1);
  }
  console.log(formatCoverage(coverage(parsed.pack), parsed.pack.meta.packVersion));
}
