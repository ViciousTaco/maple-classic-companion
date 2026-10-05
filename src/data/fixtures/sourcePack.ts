import { parsePack, type Pack } from "../pack";
import type { PackKey } from "../schema/pack";

// Test helper: assembles the real datapack/ source tree (same layout rules as scripts/lib/source.ts).
const files = import.meta.glob("../../../datapack/**/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

const SINGLE: Record<string, PackKey> = {
  "meta.json": "meta",
  "formulas.json": "formulas",
  "focus-profiles.json": "focusProfiles",
  "jobs.json": "jobs",
  "unlockables.json": "unlockables",
  "events.json": "events",
  "videos.json": "videos",
  "gear-progression.json": "gearProgression",
  "ap-builds.json": "apBuilds",
  "news-rules.json": "newsRules",
};
const REGION: Record<string, PackKey> = {
  "maps.json": "maps",
  "monsters.json": "monsters",
  "drops.json": "drops",
  "npcs.json": "npcs",
  "quests.json": "quests",
  "training-spots.json": "trainingSpots",
};

export function sourcePack(): Pack {
  const raw: Partial<Record<PackKey, unknown>> = { apBuilds: [], skills: [], items: [], maps: [], monsters: [], drops: [], npcs: [], quests: [], trainingSpots: [] };
  const push = (k: PackKey, v: unknown) => void (raw[k] = [...(raw[k] as unknown[]), ...(v as unknown[])]);
  for (const [path, value] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const rel = path.split("/datapack/")[1]!;
    const parts = rel.split("/");
    if (parts.length === 1 && SINGLE[rel]) raw[SINGLE[rel]] = value;
    else if (parts[0] === "skills") push("skills", value);
    else if (parts[0] === "items") push("items", value);
    else if (parts[0] === "regions" && parts.length === 3 && REGION[parts[2]!]) push(REGION[parts[2]!]!, value);
  }
  const r = parsePack(raw);
  if (!r.ok) throw new Error(`datapack source doesn't load: ${r.problems.join("; ")}`);
  return structuredClone(r.pack);
}
