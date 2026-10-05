import type { Pack } from "../data/pack";
import type { Monster, TrainingSpot } from "../data/schema/pack";
import type { Profile } from "../data/schema/profile";
import { rateWeight, usableDrop } from "./rates";

// Plan §8.7 step 0 + step 2 (estimate). Pure.

export type Range = { low: number; high: number };
export type Danger = "safe" | "caution" | "dangerous" | "unknown";
export type Basis = "computed" | "level-band";
export type Estimate = {
  basis: Basis;
  hitsToKill: number | null;
  killsPerHour: Range | null;
  expPerHour: Range | null;
  mesoPerHour: Range | null;
  danger: Danger;
};

export type MobShare = { mob: Monster; weight: number; count: number | null; respawn: number | null };

export type SpotEstimate = {
  estimate: Estimate;
  /** Kills/hour when computed; a relative spawn density in level-band mode (never displayed). */
  kph: number;
  mobs: MobShare[];
  /** Weighted EXP per kill (with level penalty when computed and verified). */
  expPerKill: number;
  /** Weighted meso value per kill (meso drops + NPC sell value of drops × w(rate)); null if nothing is known. */
  mesoPerKill: number | null;
  hitChanceAssumed: boolean;
};

const range = (mid: number): Range => ({ low: mid * 0.8, high: mid * 1.2 });

export function basisFor(profile: Profile): Basis {
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

/** Meso value of one kill of `mob`: average meso drop + Σ drops × NPC sell price × w(rate). Null if nothing known. */
export function mesoPerKillOf(pack: Pack, mob: Monster): number | null {
  let known = false;
  let value = 0;
  if (mob.mesoMin !== undefined && mob.mesoMax !== undefined) {
    value += (mob.mesoMin + mob.mesoMax) / 2;
    known = true;
  }
  for (const d of (pack.index.dropsByMob.get(mob.id) ?? []).filter(usableDrop)) {
    const item = pack.index.itemById.get(d.itemId);
    if (item?.npcSellMeso !== undefined) {
      value += item.npcSellMeso * rateWeight(d, pack.formulas);
      known = true;
    }
  }
  return known ? value : null;
}

export function estimateSpot(pack: Pack, profile: Profile, spot: TrainingSpot, basis: Basis = basisFor(profile)): SpotEstimate {
  const mobs = spotMobs(pack, spot);
  const danger = dangerFor(profile, mobs.map((m) => m.mob));
  const anyMeso = mobs.some((m) => mesoPerKillOf(pack, m.mob) !== null);
  const mesoPerKillRaw = mobs.reduce((a, m) => a + m.weight * (mesoPerKillOf(pack, m.mob) ?? 0), 0);
  const mesoPerKill = anyMeso ? mesoPerKillRaw : null;
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
      estimate: { basis: "level-band", hitsToKill: null, killsPerHour: null, expPerHour: null, mesoPerHour: null, danger },
      kph,
      mobs,
      expPerKill,
      mesoPerKill,
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
      mesoPerHour: mesoPerKill === null ? null : range(kph * mesoPerKill),
      danger,
    },
    kph,
    mobs,
    expPerKill,
    mesoPerKill,
    hitChanceAssumed,
  };
}
