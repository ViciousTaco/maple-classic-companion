import type { Pack } from "../data/pack";
import type { Monster, TrainingSpot } from "../data/schema/pack";
import type { Profile } from "../data/schema/profile";
import { observedRates, type ObservedRates } from "./observed";
import { knownProbability, rateWeight, usableDrop } from "./rates";

// Plan §8.7 step 0 + step 2 (estimate). Pure.

export type Range = { low: number; high: number };
export type Danger = "safe" | "caution" | "dangerous" | "unknown";
/** How the shown numbers were made. "observed" = measured by the screen watcher at this spot (I-29). */
export type Basis = "computed" | "level-band" | "observed";
export type Estimate = {
  basis: Basis;
  hitsToKill: number | null;
  killsPerHour: Range | null;
  expPerHour: Range | null;
  mesoPerHour: Range | null;
  danger: Danger;
  /** Present when the screen watcher measured this spot long enough (the shown numbers then come from it). */
  observed: ObservedRates | null;
};

export type MobShare = { mob: Monster; weight: number; count: number | null; respawn: number | null };

export type SpotEstimate = {
  estimate: Estimate;
  /** Kills/hour when computed; a relative spawn density in level-band mode (never displayed). */
  kph: number;
  mobs: MobShare[];
  /** Weighted EXP per kill (with level penalty when computed and verified). */
  expPerKill: number;
  /** Ranking value per kill: meso drops + NPC sell value × w(rate) (heuristic weights allowed; never displayed). */
  mesoPerKill: number | null;
  /** Displayable meso per kill: only known meso ranges + drops with an official/sampled rate (§6.3); null otherwise. */
  mesoPerKillShown: number | null;
  hitChanceAssumed: boolean;
};

const range = (mid: number): Range => ({ low: mid * 0.8, high: mid * 1.2 });

export function basisFor(profile: Profile): Exclude<Basis, "observed"> {
  const { damageMin, damageMax } = profile.combat;
  return damageMin !== undefined && damageMax !== undefined && damageMin > 0 && damageMax > 0 ? "computed" : "level-band";
}

/** A spot's mobs with spawn weights: count share when every count is known, otherwise equal (§15). */
export function spotMobs(pack: Pack, spot: TrainingSpot): MobShare[] {
  const map = pack.index.mapById.get(spot.mapId);
  const rows = spot.mobIds
    .map((id) => {
      const mob = pack.index.monsterById.get(id);
      const spawn = map?.spawns.find((s) => s.mobId === id);
      return mob ? { mob, count: spawn?.count ?? null, respawn: spawn?.respawnSec ?? pack.meta.defaultRespawnSec } : null;
    })
    .filter((x): x is Omit<MobShare, "weight"> => x !== null);
  const allCounts = rows.length > 0 && rows.every((r) => r.count !== null);
  const total = allCounts ? rows.reduce((a, r) => a + r.count!, 0) : rows.length;
  return rows.map((r) => ({ ...r, weight: allCounts ? r.count! / total : 1 / rows.length }));
}

function levelPenalty(pack: Pack, mobLevel: number, playerLevel: number): number {
  const lp = pack.formulas.levelPenalty;
  if (!lp?.verified || lp.table.length === 0) return 1;
  const diff = mobLevel - playerLevel;
  const sorted = [...lp.table].sort((a, b) => a.diff - b.diff);
  let mult = sorted[0]!.mult;
  for (const row of sorted) if (row.diff <= diff) mult = row.mult;
  return mult;
}

export function dangerFor(profile: Profile, mobs: Monster[]): Danger {
  const hp = profile.stats.hp;
  const touch = Math.max(0, ...mobs.map((m) => m.touchDmgMax ?? 0));
  if (!hp || touch <= 0) return "unknown";
  const hitsToDie = hp / touch;
  return hitsToDie >= 8 ? "safe" : hitsToDie >= 4 ? "caution" : "dangerous";
}

/**
 * Meso value of one kill of `mob`. "rank": average meso drop + Σ drops × NPC sell price × w(rate), using heuristic
 * weights for unknown rates (ranking only). "shown": only what's actually known — the meso range plus drops with an
 * official or sampled rate; null when the meso range itself is unknown (never a made-up number on screen).
 */
export function mesoPerKillOf(pack: Pack, mob: Monster, mode: "rank" | "shown" = "rank"): number | null {
  let known = false;
  let value = 0;
  if (mob.mesoMin !== undefined && mob.mesoMax !== undefined) {
    value += (mob.mesoMin + mob.mesoMax) / 2;
    known = true;
  } else if (mode === "shown") return null;
  for (const d of (pack.index.dropsByMob.get(mob.id) ?? []).filter(usableDrop)) {
    const item = pack.index.itemById.get(d.itemId);
    if (item?.npcSellMeso === undefined) continue;
    if (mode === "shown") {
      const p = knownProbability(d);
      if (p) value += item.npcSellMeso * p.p;
    } else {
      value += item.npcSellMeso * rateWeight(d, pack.formulas);
      known = true;
    }
  }
  return known ? value : null;
}

export function estimateSpot(pack: Pack, profile: Profile, spot: TrainingSpot, basis: Exclude<Basis, "observed"> = basisFor(profile)): SpotEstimate {
  const est = estimateFromData(pack, profile, spot, basis);
  const observed = observedRates(pack, profile.observations[spot.id] ?? profile.observations[`map:${spot.mapId}`]);
  if (!observed) return est;
  // Measured numbers win for display. For ranking they replace computed kills/hour; level-band ranking compares
  // relative densities, so a measured spot keeps its density there to stay comparable with the others.
  return {
    ...est,
    kph: est.estimate.basis === "computed" ? (observed.kills / observed.minutes) * 60 : est.kph,
    estimate: {
      ...est.estimate,
      basis: "observed",
      killsPerHour: observed.killsPerHour,
      expPerHour: observed.expPerHour,
      mesoPerHour: observed.mesoPerHour,
      observed,
    },
  };
}

function estimateFromData(pack: Pack, profile: Profile, spot: TrainingSpot, basis: Exclude<Basis, "observed">): SpotEstimate {
  const mobs = spotMobs(pack, spot);
  const danger = dangerFor(profile, mobs.map((m) => m.mob));
  const anyMeso = mobs.some((m) => mesoPerKillOf(pack, m.mob) !== null);
  const mesoPerKillRaw = mobs.reduce((a, m) => a + m.weight * (mesoPerKillOf(pack, m.mob) ?? 0), 0);
  const mesoPerKill = anyMeso ? mesoPerKillRaw : null;
  const shownParts = mobs.map((m) => mesoPerKillOf(pack, m.mob, "shown"));
  const mesoPerKillShown =
    mobs.length > 0 && shownParts.every((x) => x !== null) ? mobs.reduce((a, m, i) => a + m.weight * shownParts[i]!, 0) : null;
  const archetype = pack.jobs.find((j) => j.id === profile.jobId)?.archetype ?? "melee";
  const countsKnown = mobs.length > 0 && mobs.every((m) => m.count !== null);
  const respawnKnown = mobs.length > 0 && mobs.every((m) => m.respawn !== null);

  if (basis === "level-band" || mobs.length === 0) {
    // Relative density for ranking only: Σcount / respawn (or Σcount, or 1 when counts are unknown).
    const sumCount = countsKnown ? mobs.reduce((a, m) => a + m.count!, 0) : 1;
    const respawn = respawnKnown ? mobs.reduce((a, m) => a + m.weight * m.respawn!, 0) : null;
    const kph = respawn ? sumCount / respawn : sumCount;
    const expPerKill = mobs.reduce((a, m) => a + m.weight * m.mob.exp, 0);
    return {
      estimate: { basis: "level-band", hitsToKill: null, killsPerHour: null, expPerHour: null, mesoPerHour: null, danger, observed: null },
      kph,
      mobs,
      expPerKill,
      mesoPerKill,
      mesoPerKillShown,
      hitChanceAssumed: false,
    };
  }

  const { damageMin, damageMax } = profile.combat;
  const avg = (damageMin! + damageMax!) / 2;
  let perAttack = avg;
  let targets = 1;
  const skill = profile.combat.mainSkillId ? pack.index.skillById.get(profile.combat.mainSkillId) : undefined;
  const skillLevel = skill ? (profile.skills[skill.id] ?? 0) : 0;
  const row = skill?.kind === "attack" && skillLevel > 0 ? skill.levels?.find((l) => l.level === skillLevel) : undefined;
  if (skill && row?.damagePct !== undefined) {
    perAttack = avg * (row.damagePct / 100) * (row.hits ?? 1);
    targets = row.targets ?? 1;
  }

  const hc = pack.formulas.hitChance;
  let hitChance: number;
  let hitChanceAssumed = false;
  if (hc?.verified && hc.kind === "flat" && typeof hc.params.chance === "number") {
    hitChance = Math.min(1, Math.max(0.01, hc.params.chance));
  } else {
    hitChance = archetype === "mage" ? 1 : 0.9;
    hitChanceAssumed = true;
  }

  const interval = pack.formulas.defaultAttackIntervalSec;
  const mobility = spot.mobilitySec ?? 1.5;
  const perMob = mobs.map((m) => {
    const hits = Math.max(1, Math.ceil(m.mob.hp / perAttack));
    return { ...m, hits, secPerKill: (hits * interval) / hitChance + mobility };
  });
  const weightedSec = perMob.reduce((a, m) => a + m.weight * m.secPerKill, 0);
  const aoe = 1 + pack.formulas.aoeEfficiency * (Math.min(targets, 6) - 1);
  const playerKph = (aoe * 3600) / weightedSec;
  const spawnKph = countsKnown && respawnKnown ? mobs.reduce((a, m) => a + (m.count! * 3600) / m.respawn!, 0) : Infinity;
  const kph = Math.min(playerKph, 0.85 * spawnKph);
  const expPerKill = mobs.reduce((a, m) => a + m.weight * m.mob.exp * levelPenalty(pack, m.mob.level, profile.level), 0);
  const main = [...perMob].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0]!;

  return {
    estimate: {
      basis: "computed",
      hitsToKill: main.hits,
      killsPerHour: range(kph),
      expPerHour: range(kph * expPerKill),
      mesoPerHour: mesoPerKillShown === null ? null : range(kph * mesoPerKillShown),
      danger,
      observed: null,
    },
    kph,
    mobs,
    expPerKill,
    mesoPerKill,
    mesoPerKillShown,
    hitChanceAssumed,
  };
}
