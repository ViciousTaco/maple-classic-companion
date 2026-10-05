import type { Pack } from "../data/pack";
import type { Confidence, TrainingSpot } from "../data/schema/pack";
import type { Profile } from "../data/schema/profile";
import { basisFor, estimateSpot, type Estimate, type Range, type SpotEstimate } from "./estimate";
import { jobFamily, isClassEquip, normalise, rawSubscores, type RawSubscores } from "./subscores";
import { reasonsFor, warningsFor, type Reason } from "./reasons";
import { bandFit, DEFAULT_FOCUS_WEIGHTS, finalScore, pickPlan, relaxedFit, type SubscoreKey } from "./weights";
import { usableDrop } from "./rates";

// Plan §8.7 (binding contract; deviations logged in §15).

export type { Range, Estimate, Reason };

export type Recommendation = {
  spotId: string;
  mapId: string;
  score: number;
  fit: number;
  subscores: Record<SubscoreKey, number>;
  estimate: Estimate;
  reasons: Reason[];
  warnings: Reason[];
  notableDropItemIds: string[];
  confidence: Confidence;
  stretch: boolean;
};

export type TrainingPlan = {
  primary: Recommendation | null;
  backups: Recommendation[];
  considered: number;
  emptyReason?: "no-data-for-level" | "all-skipped";
  /** Party-only spots that fit the level — shown separately as "needs a party" (additive, §15). */
  partySpots: Recommendation[];
};

type Band = TrainingSpot["bands"][number];

/** Best band for the profile: a jobs match beats an archetype match beats "any"; ties go to the better fit. */
export function bestBand(pack: Pack, profile: Profile, spot: TrainingSpot, fitFn = bandFit): { band: Band; fit: number } | null {
  const archetype = pack.jobs.find((j) => j.id === profile.jobId)?.archetype ?? "melee";
  const rank = (b: Band) => (b.jobs?.includes(profile.jobId) ? 3 : b.jobs?.length ? 0 : b.archetype === archetype ? 2 : b.archetype === "any" ? 1 : 0);
  let best: { band: Band; fit: number; rank: number } | null = null;
  for (const band of spot.bands) {
    const r = rank(band);
    if (r === 0) continue;
    const fit = fitFn(profile.level, band.min, band.max);
    if (!best || r > best.rank || (r === best.rank && fit > best.fit)) best = { band, fit, rank: r };
  }
  return best && { band: best.band, fit: best.fit };
}

type Candidate = { spot: TrainingSpot; fit: number; est: SpotEstimate; raw: RawSubscores; stretch: boolean };

function regionOk(pack: Pack, profile: Profile, spot: TrainingSpot): boolean {
  const map = pack.index.mapById.get(spot.mapId);
  if (!map || !pack.meta.regionsAvailable.includes(map.region)) return false;
  return !pack.meta.gatedRegions.includes(map.region) || profile.unlocks.areas.includes(map.region);
}

function spotConfidence(pack: Pack, spot: TrainingSpot): Confidence {
  const order: Confidence[] = ["unverified", "likely", "verified"];
  const levels = [spot.confidence, ...spot.mobIds.map((id) => pack.index.monsterById.get(id)?.confidence ?? "unverified")];
  return order[Math.min(...levels.map((c) => order.indexOf(c)))]!;
}

export function recommendTraining(input: { profile: Profile; pack: Pack; now: Date }): TrainingPlan {
  const { profile, pack, now } = input;
  const weights = pack.focusProfiles[profile.focus] ?? DEFAULT_FOCUS_WEIGHTS[profile.focus];
  const basis = basisFor(profile);
  const skipped = new Set(profile.skippedSpots.filter((s) => Date.parse(s.until) > now.getTime()).map((s) => s.spotId));
  const spots = [...pack.trainingSpots].sort((a, b) => a.id.localeCompare(b.id)); // ties broken by spotId (step 7)

  const collect = (fitFn: typeof bandFit, exclude: Set<string>, stretch: boolean) => {
    const out: Candidate[] = [];
    const party: Candidate[] = [];
    let skippedOnly = 0;
    for (const spot of spots) {
      if (exclude.has(spot.id)) continue;
      const bb = bestBand(pack, profile, spot, fitFn);
      if (!bb || bb.fit === 0 || !regionOk(pack, profile, spot)) continue;
      const est = estimateSpot(pack, profile, spot, basis);
      const c: Candidate = { spot, fit: bb.fit, est, raw: rawSubscores(pack, profile, spot, est), stretch };
      if (spot.party === "party") party.push(c);
      else if (skipped.has(spot.id)) skippedOnly++;
      else out.push(c);
    }
    return { out, party, skippedOnly };
  };

  const toRecs = (cands: Candidate[]): Recommendation[] => {
    const subs = normalise(cands.map((c) => c.raw));
    const scored = cands.map((c, i) => ({ c, sub: subs[i]!, score: finalScore(subs[i]!, weights, c.fit, spotConfidence(pack, c.spot)) }));
    return scored.map(({ c, sub, score }) => ({
      spotId: c.spot.id,
      mapId: c.spot.mapId,
      score,
      fit: c.fit,
      subscores: sub,
      estimate: c.est.estimate,
      reasons: reasonsFor({ sub, weights, raw: c.raw, all: scored.map((s) => s.sub), self: sub }),
      warnings: warningsFor({ est: c.est, stretch: c.stretch, confidence: spotConfidence(pack, c.spot) }),
      notableDropItemIds: notableDrops(pack, profile, c),
      confidence: spotConfidence(pack, c.spot),
      stretch: c.stretch,
    }));
  };

  const normal = collect(bandFit, new Set(), false);
  let pool = normal.out;
  let recs = toRecs(pool);
  let plan = pickPlan(recs);
  let primary = plan.primary;
  let backups = plan.backups;

  if (!primary || backups.length === 0) {
    // Step 5: relax the bands for stretch options (scored together so subscores stay comparable).
    const relaxed = collect(relaxedFit, new Set(pool.map((c) => c.spot.id)), true);
    if (relaxed.out.length) {
      pool = [...pool, ...relaxed.out];
      recs = toRecs(pool);
      const byId = new Map(recs.map((r) => [r.spotId, r]));
      const normals = normal.out.map((c) => byId.get(c.spot.id)!);
      const stretches = relaxed.out.map((c) => byId.get(c.spot.id)!);
      plan = pickPlan(normals);
      primary = plan.primary;
      if (primary) {
        const used = new Set([primary.mapId]);
        backups = [];
        for (const r of [...stretches].sort((a, b) => b.score - a.score)) {
          if (backups.length >= 3) break;
          if (used.has(r.mapId)) continue;
          used.add(r.mapId);
          backups.push(r);
        }
      } else {
        const p = pickPlan(stretches);
        primary = p.primary;
        backups = p.backups;
      }
    }
  }

  const partySpots = toRecs(normal.party).sort((a, b) => b.score - a.score || a.spotId.localeCompare(b.spotId));
  if (!primary) {
    return {
      primary: null,
      backups: [],
      considered: pool.length,
      emptyReason: normal.out.length === 0 && normal.skippedOnly > 0 ? "all-skipped" : "no-data-for-level",
      partySpots,
    };
  }
  return { primary, backups, considered: pool.length, partySpots };
}

function notableDrops(pack: Pack, profile: Profile, c: Candidate): string[] {
  const family = jobFamily(pack, profile);
  const wish = new Set(profile.wishlistItemIds);
  const ids = new Set<string>();
  for (const m of c.est.mobs)
    for (const d of (pack.index.dropsByMob.get(m.mob.id) ?? []).filter(usableDrop)) {
      const item = pack.index.itemById.get(d.itemId);
      if (!item) continue;
      if (wish.has(item.id) || item.rarity === "rare" || item.rarity === "very-rare" || isClassEquip(item, family, profile.level)) ids.add(item.id);
    }
  return [...ids].sort((a, b) => Number(wish.has(b)) - Number(wish.has(a)) || a.localeCompare(b)).slice(0, 5);
}
