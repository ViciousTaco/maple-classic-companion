import type { Pack } from "../data/pack";
import type { Quest } from "../data/schema/pack";
import type { JobId, Profile } from "../data/schema/profile";

// Plan P4-T7.

/** The character's job and its ancestors (a Bandit may do Thief quests). */
function jobAncestry(pack: Pack, jobId: JobId): Set<JobId> {
  const out = new Set<JobId>([jobId]);
  for (let j = pack.jobs.find((x) => x.id === jobId); j?.parent; j = pack.jobs.find((x) => x.id === j!.parent)) out.add(j.parent);
  return out;
}

function windowOpen(q: Quest, now: Date): boolean {
  const t = now.getTime();
  if (q.availableFromUtc && Date.parse(q.availableFromUtc) > t) return false;
  if (q.availableUntilUtc && Date.parse(q.availableUntilUtc) <= t) return false;
  return true;
}

/**
 * Job-advancement quests need the exact current job (a Thief doesn't see "Path of the Bowman", which is a
 * Beginner quest). Other quests are open to the job and anything it advanced from.
 */
function jobOk(pack: Pack, q: Quest, profile: Profile): boolean {
  if (!q.jobs?.length) return true;
  if (q.category === "job") return q.jobs.includes(profile.jobId);
  const mine = jobAncestry(pack, profile.jobId);
  return q.jobs.some((j) => mine.has(j));
}

const done = (profile: Profile, q: Quest) => profile.unlocks.questsDone.includes(q.id) && !q.repeatable;

export function availableQuests(profile: Profile, pack: Pack, now: Date): Quest[] {
  const finished = new Set(profile.unlocks.questsDone);
  return pack.quests.filter(
    (q) =>
      !done(profile, q) &&
      q.minLevel <= profile.level &&
      (q.maxLevel === undefined || profile.level <= q.maxLevel) &&
      jobOk(pack, q, profile) &&
      q.prereqQuestIds.every((p) => finished.has(p)) &&
      windowOpen(q, now),
  );
}

/** Not available yet, but within 5 levels or one prerequisite away. */
export function comingSoon(profile: Profile, pack: Pack, now: Date): Quest[] {
  const available = new Set(availableQuests(profile, pack, now).map((q) => q.id));
  const finished = new Set(profile.unlocks.questsDone);
  return pack.quests.filter((q) => {
    if (available.has(q.id) || done(profile, q) || !jobOk(pack, q, profile)) return false;
    if (q.maxLevel !== undefined && profile.level > q.maxLevel) return false;
    if (q.availableUntilUtc && Date.parse(q.availableUntilUtc) <= now.getTime()) return false;
    const missing = q.prereqQuestIds.filter((p) => !finished.has(p)).length;
    const levelSoon = q.minLevel > profile.level && q.minLevel <= profile.level + 5;
    return (levelSoon && missing === 0) || (q.minLevel <= profile.level + 5 && missing === 1);
  });
}

function chainLength(pack: Pack, q: Quest): number {
  return q.chainId ? pack.quests.filter((x) => x.chainId === q.chainId).length : 1;
}

/** Expiring soonest first, then reward EXP relative to level, then shorter chains, then id. */
export function rankQuests(quests: Quest[], profile: Profile, pack: Pack): Quest[] {
  const expiry = (q: Quest) => (q.availableUntilUtc ? Date.parse(q.availableUntilUtc) : Infinity);
  const value = (q: Quest) => (q.rewards.exp ?? 0) / Math.max(1, profile.level);
  return [...quests].sort(
    (a, b) => expiry(a) - expiry(b) || value(b) - value(a) || chainLength(pack, a) - chainLength(pack, b) || a.id.localeCompare(b.id),
  );
}
