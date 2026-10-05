import metaJson from "../../datapack/meta.json";
import jobsJson from "../../datapack/jobs.json";
import unlockablesJson from "../../datapack/unlockables.json";
import type { JobId } from "./schema/profile";
import type { PackData } from "./schema/pack";

// Typed view of the parts of the pack the character screens need. `rulesFromPack` is used at runtime;
// `baselineRules` (straight from the datapack source) is the fallback if no pack can be loaded.

export type JobFamily = "beginner" | "warrior" | "magician" | "bowman" | "thief";
export type JobInfo = {
  id: JobId;
  name: string;
  family: JobFamily;
  tier: number;
  parent: JobId | null;
  archetype: "melee" | "ranged" | "mage";
  instructor?: string;
  town?: string;
};
export type JobAdvancement = { level: number; from: JobId; to: JobId[]; npcId?: string };
type Named = { id: string; name: string };

export type GameRules = {
  packVersion: string;
  gameLabel: string;
  gameLabelUntilUtc?: string;
  levelCap: number;
  charactersPerAccount: number;
  jobAdvancements: JobAdvancement[];
  jobs: JobInfo[];
  regions: Named[];
  bosses: Named[];
  partyQuests: (Named & { town: string; minLevel: number; finalBoss?: string })[];
  crafting: (Named & { npc: string; minLevel: number })[];
  citizenship: {
    minLevel: number;
    towns: { id: "henesys" | "kerning"; name: string; npc: string; place: string }[];
  };
};

export const baselineRules: GameRules = {
  packVersion: metaJson.packVersion,
  gameLabel: metaJson.gameLabel,
  gameLabelUntilUtc: (metaJson as { gameLabelUntilUtc?: string }).gameLabelUntilUtc,
  levelCap: metaJson.levelCap,
  charactersPerAccount: metaJson.charactersPerAccount,
  jobAdvancements: metaJson.jobAdvancements as JobAdvancement[],
  jobs: jobsJson as JobInfo[],
  regions: unlockablesJson.regions,
  bosses: unlockablesJson.bosses,
  partyQuests: unlockablesJson.partyQuests,
  crafting: unlockablesJson.crafting,
  citizenship: unlockablesJson.citizenship as GameRules["citizenship"],
};

export function rulesFromPack(pack: PackData): GameRules {
  return {
    packVersion: pack.meta.packVersion,
    gameLabel: pack.meta.gameLabel,
    gameLabelUntilUtc: pack.meta.gameLabelUntilUtc,
    levelCap: pack.meta.levelCap,
    charactersPerAccount: pack.meta.charactersPerAccount,
    jobAdvancements: pack.meta.jobAdvancements,
    jobs: pack.jobs,
    regions: pack.unlockables.regions,
    bosses: pack.unlockables.bosses,
    partyQuests: pack.unlockables.partyQuests,
    crafting: pack.unlockables.crafting,
    citizenship: pack.unlockables.citizenship,
  };
}

/** The phase label ("Founder's Access") while it applies; null once its end time has passed. */
export function activeGameLabel(rules: Pick<GameRules, "gameLabel" | "gameLabelUntilUtc">, now: Date): string | null {
  if (rules.gameLabelUntilUtc && now.getTime() >= Date.parse(rules.gameLabelUntilUtc)) return null;
  return rules.gameLabel;
}

/** Level at which a job can first be held, from the pack's advancement rows (Beginner = 1). */
export function requiredLevel(rules: GameRules, jobId: JobId): number {
  const row = rules.jobAdvancements.find((a) => a.to.includes(jobId));
  return row ? row.level : 1;
}

export function jobById(rules: GameRules, id: JobId): JobInfo | undefined {
  return rules.jobs.find((j) => j.id === id);
}

export function jobName(rules: GameRules, id: JobId): string {
  return jobById(rules, id)?.name ?? id;
}

/** Jobs a character of this level could hold, in pack order. */
export function jobsForLevel(rules: GameRules, level: number): JobInfo[] {
  return rules.jobs.filter((j) => requiredLevel(rules, j.id) <= level);
}

/** Ancestors and descendants of `jobId` (inclusive) — the character's own class line. */
export function jobLine(rules: GameRules, jobId: JobId): Set<JobId> {
  const line = new Set<JobId>([jobId]);
  if (jobId === "beginner") return line;
  for (let j = jobById(rules, jobId); j?.parent && j.parent !== "beginner"; j = jobById(rules, j.parent)) {
    line.add(j.parent);
  }
  const queue: JobId[] = [jobId];
  for (let id = queue.shift(); id; id = queue.shift()) {
    for (const child of rules.jobs.filter((j) => j.parent === id)) {
      line.add(child.id);
      queue.push(child.id);
    }
  }
  return line;
}

/** The next advancement for this job, if any (e.g. Thief → Lv 30 Assassin/Bandit). */
export function nextAdvancement(rules: GameRules, jobId: JobId): JobAdvancement | undefined {
  return rules.jobAdvancements
    .filter((a) => a.from === jobId)
    .sort((a, b) => a.level - b.level)[0];
}

export function clampLevel(rules: GameRules, level: number): number {
  return Math.min(rules.levelCap, Math.max(1, Math.round(level)));
}
