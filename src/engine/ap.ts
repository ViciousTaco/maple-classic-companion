import type { Pack } from "../data/pack";
import type { ApBuild, Item } from "../data/schema/pack";
import type { JobId, Profile } from "../data/schema/profile";
import { nextUpgrades } from "./gear";

// Where to put ability points (the owner request 2026-10-05). Only sourced builds are used — nothing is invented.

export type Stat = "str" | "dex" | "int" | "luk";
export type ApPhase = ApBuild["phases"][number];
export type StatStep = { stat: Stat; target: number; current: number | null; add: number | null };
export type ApAdvice = {
  build: ApBuild;
  phase: ApPhase;
  /** Targets to top up first (with how many points are still needed when current stats are known). */
  steps: StatStep[];
  /** Where every other point goes. */
  rest: Stat;
  nextPhase: ApPhase | null;
  exact: boolean;
};

/** Earlier jobs in the line, excluding Beginner (a Beginner build doesn't carry over to a class). */
function ancestors(pack: Pack, jobId: JobId): JobId[] {
  const out: JobId[] = [];
  for (let j = pack.jobs.find((x) => x.id === jobId); j?.parent; j = pack.jobs.find((x) => x.id === j!.parent)) {
    if (j.parent !== "beginner") out.push(j.parent);
  }
  return out;
}

/** Builds for the character's job (exact first), falling back to builds for its earlier jobs. Recommended first. */
export function apAdvice(profile: Profile, pack: Pack): ApAdvice[] {
  const anc = ancestors(pack, profile.jobId);
  const rank = (b: ApBuild) => (b.jobs.includes(profile.jobId) ? 2 : b.jobs.some((j) => anc.includes(j)) ? 1 : 0);
  const builds = pack.apBuilds
    .filter((b) => rank(b) > 0)
    .sort((a, b) => rank(b) - rank(a) || Number(!!b.recommended) - Number(!!a.recommended) || a.id.localeCompare(b.id));
  const out: ApAdvice[] = [];
  for (const build of builds) {
    const phases = [...build.phases].sort((a, b) => a.fromLevel - b.fromLevel);
    const phase = phases.find((p) => p.fromLevel <= profile.level && (p.toLevel === undefined || profile.level <= p.toLevel));
    if (!phase) continue;
    const steps: StatStep[] = Object.entries(phase.targets ?? {}).map(([stat, t]) => {
      const target = Math.round((t?.base ?? 0) + (t?.perLevel ?? 0) * profile.level);
      const current = profile.stats[stat as Stat] ?? null;
      return { stat: stat as Stat, target, current, add: current === null ? null : Math.max(0, target - current) };
    });
    out.push({ build, phase, steps, rest: phase.primary, nextPhase: phases.find((p) => p.fromLevel > profile.level) ?? null, exact: rank(build) === 2 });
  }
  return out;
}

export type GearNeed = { item: Item; level: number; stat: Stat; need: number; current: number | null; short: number | null };

/** Stat requirements of the next upgrades that the character doesn't meet yet (or can't be checked). */
export function gearStatNeeds(profile: Profile, pack: Pack): GearNeed[] {
  const out: GearNeed[] = [];
  const primary = apAdvice(profile, pack)[0]?.rest ?? null;
  for (const u of nextUpgrades(profile, pack, 5, primary).filter((x) => x.fitsBuild)) {
    for (const [stat, need] of Object.entries(u.item.reqStats ?? {})) {
      if (!need) continue;
      const current = profile.stats[stat as Stat] ?? null;
      const short = current === null ? null : Math.max(0, need - current);
      if (short === 0) continue;
      out.push({ item: u.item, level: u.level, stat: stat as Stat, need, current, short });
    }
  }
  return out.sort((a, b) => a.level - b.level || a.item.id.localeCompare(b.item.id));
}

export const STAT_LABEL: Record<Stat, string> = { str: "STR", dex: "DEX", int: "INT", luk: "LUK" };
