// Reads the hand-edited datapack/ source tree and assembles one object per pack key.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PackKey } from "../../src/data/schema/pack";

export type SourceRead = { raw: Partial<Record<PackKey, unknown>>; problems: string[] };

const SINGLE: [PackKey, string, "object" | "array"][] = [
  ["meta", "meta.json", "object"],
  ["formulas", "formulas.json", "object"],
  ["focusProfiles", "focus-profiles.json", "object"],
  ["jobs", "jobs.json", "array"],
  ["unlockables", "unlockables.json", "object"],
  ["events", "events.json", "array"],
  ["videos", "videos.json", "array"],
  ["gearProgression", "gear-progression.json", "array"],
  ["apBuilds", "ap-builds.json", "array"],
  ["newsRules", "news-rules.json", "object"],
];

const REGION_FILES: [PackKey, string][] = [
  ["maps", "maps.json"],
  ["monsters", "monsters.json"],
  ["drops", "drops.json"],
  ["npcs", "npcs.json"],
  ["quests", "quests.json"],
  ["trainingSpots", "training-spots.json"],
];

export function readSource(root: string): SourceRead {
  const raw: Partial<Record<PackKey, unknown>> = {};
  const problems: string[] = [];

  const readJson = (path: string): unknown => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      problems.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  };
  const concat = (key: PackKey, path: string) => {
    const v = readJson(path);
    if (v === undefined) return;
    if (!Array.isArray(v)) return void problems.push(`${path}: expected a JSON array`);
    raw[key] = [...((raw[key] as unknown[]) ?? []), ...v];
  };
  const dirFiles = (dir: string) =>
    existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => join(dir, f)) : [];

  for (const [key, file, kind] of SINGLE) {
    const path = join(root, file);
    if (!existsSync(path)) {
      if (kind === "array") raw[key] = [];
      continue; // required objects are reported as missing by the validator
    }
    raw[key] = readJson(path);
  }

  raw.skills = [];
  for (const f of dirFiles(join(root, "skills"))) concat("skills", f);
  raw.items = [];
  for (const f of dirFiles(join(root, "items"))) concat("items", f);

  for (const [key] of REGION_FILES) raw[key] = [];
  const regionsDir = join(root, "regions");
  const regions = existsSync(regionsDir) ? readdirSync(regionsDir).filter((d) => statSync(join(regionsDir, d)).isDirectory()).sort() : [];
  for (const region of regions)
    for (const [key, file] of REGION_FILES) {
      const path = join(regionsDir, region, file);
      if (existsSync(path)) concat(key, path);
    }

  return { raw, problems };
}
