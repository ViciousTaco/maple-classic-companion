import type { z } from "zod";
import { NewsRulesSchema } from "../features/news/schema";
import {
  FocusProfilesSchema,
  FormulasSchema,
  GameEventSchema,
  GearEntrySchema,
  DropSchema,
  ItemSchema,
  JobSchema,
  MapSchema,
  MetaSchema,
  MonsterSchema,
  NpcSchema,
  PACK_FILES,
  QuestSchema,
  SkillSchema,
  TrainingSpotSchema,
  UnlockablesSchema,
  ApBuildSchema,
  VideoSchema,
  type PackData,
  type PackKey,
  type Source,
} from "./schema/pack";

// Plan §8.5 validator rules. Any issue fails the datapack build; the app runs rules 1–2 before installing a pack.

export type Issue = { rule: number; file: string; where: string; message: string };

const ARRAY_OF = <T extends z.ZodType>(s: T) => s.array();
const SCHEMAS: Record<PackKey, z.ZodType> = {
  meta: MetaSchema,
  formulas: FormulasSchema,
  focusProfiles: FocusProfilesSchema,
  jobs: ARRAY_OF(JobSchema),
  unlockables: UnlockablesSchema,
  events: ARRAY_OF(GameEventSchema),
  videos: ARRAY_OF(VideoSchema),
  gearProgression: ARRAY_OF(GearEntrySchema),
  skills: ARRAY_OF(SkillSchema),
  items: ARRAY_OF(ItemSchema),
  maps: ARRAY_OF(MapSchema),
  monsters: ARRAY_OF(MonsterSchema),
  drops: ARRAY_OF(DropSchema),
  npcs: ARRAY_OF(NpcSchema),
  quests: ARRAY_OF(QuestSchema),
  trainingSpots: ARRAY_OF(TrainingSpotSchema),
  apBuilds: ARRAY_OF(ApBuildSchema),
  newsRules: NewsRulesSchema,
};

export const PACK_KEYS = Object.keys(PACK_FILES) as PackKey[];

/** Rule 1 (shape): parse every file. Returns the typed pack only if everything parsed. */
export function parsePackFiles(raw: Partial<Record<PackKey, unknown>>): { pack: PackData | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const out: Partial<Record<PackKey, unknown>> = {};
  for (const key of PACK_KEYS) {
    const file = PACK_FILES[key];
    if (raw[key] === undefined) {
      issues.push({ rule: 1, file, where: "(file)", message: "file is missing" });
      continue;
    }
    const r = SCHEMAS[key].safeParse(raw[key]);
    if (r.success) out[key] = r.data;
    else
      for (const i of r.error.issues.slice(0, 50))
        issues.push({ rule: 1, file, where: i.path.map(String).join(".") || "(root)", message: i.message });
  }
  return { pack: issues.length ? null : (out as PackData), issues };
}

type Opts = { now?: Date; level?: "all" | "integrity" };

/** Rules 1 (unique ids) … 14 on a parsed pack. `level: "integrity"` runs rules 1–2 only (§8.6 step 6). */
export function validatePack(pack: PackData, opts: Opts = {}): Issue[] {
  const now = opts.now ?? new Date();
  const issues: Issue[] = [];
  const add = (rule: number, key: PackKey, where: string, message: string) =>
    issues.push({ rule, file: PACK_FILES[key], where, message });

  // ---- Rule 1: ids unique per type ----
  const idSets: Partial<Record<PackKey, Set<string>>> = {};
  const unique = (key: PackKey, list: { id: string }[]) => {
    const seen = new Set<string>();
    for (const r of list) {
      if (seen.has(r.id)) add(1, key, r.id, `duplicate id "${r.id}"`);
      seen.add(r.id);
    }
    idSets[key] = seen;
    return seen;
  };
  const jobs = unique("jobs", pack.jobs);
  unique("events", pack.events);
  const videos = unique("videos", pack.videos);
  unique("gearProgression", pack.gearProgression);
  unique("skills", pack.skills);
  const items = unique("items", pack.items);
  const maps = unique("maps", pack.maps);
  const monsters = unique("monsters", pack.monsters);
  const npcs = unique("npcs", pack.npcs);
  const quests = unique("quests", pack.quests);
  unique("trainingSpots", pack.trainingSpots);
  unique("apBuilds", pack.apBuilds);
  for (const [group, list] of [
    ["regions", pack.unlockables.regions],
    ["bosses", pack.unlockables.bosses],
    ["partyQuests", pack.unlockables.partyQuests],
    ["crafting", pack.unlockables.crafting],
  ] as const) {
    const seen = new Set<string>();
    for (const r of list) {
      if (seen.has(r.id)) add(1, "unlockables", `${group}.${r.id}`, `duplicate id "${r.id}"`);
      seen.add(r.id);
    }
  }
  const dropPairs = new Set<string>();
  for (const d of pack.drops) {
    const k = `${d.mobId}→${d.itemId}`;
    if (dropPairs.has(k)) add(1, "drops", k, `duplicate drop ${k}`);
    dropPairs.add(k);
  }

  // ---- Rule 2: referential integrity ----
  const ref = (key: PackKey, where: string, kind: string, value: string, set: Set<string>) => {
    if (!set.has(value)) add(2, key, where, `unknown ${kind} "${value}"`);
  };
  for (const m of pack.maps) {
    m.spawns.forEach((s, i) => ref("maps", `${m.id}.spawns[${i}]`, "monster", s.mobId, monsters));
    m.links.forEach((l, i) => ref("maps", `${m.id}.links[${i}]`, "map", l.to, maps));
    m.npcIds.forEach((n) => ref("maps", `${m.id}.npcIds`, "npc", n, npcs));
  }
  for (const n of pack.npcs) ref("npcs", n.id, "map", n.mapId, maps);
  for (const d of pack.drops) {
    ref("drops", `${d.mobId}→${d.itemId}`, "monster", d.mobId, monsters);
    ref("drops", `${d.mobId}→${d.itemId}`, "item", d.itemId, items);
  }
  for (const q of pack.quests) {
    q.prereqQuestIds.forEach((p) => ref("quests", `${q.id}.prereqQuestIds`, "quest", p, quests));
    ref("quests", `${q.id}.startNpcId`, "npc", q.startNpcId, npcs);
    q.steps.forEach((s, i) => {
      const w = `${q.id}.steps[${i}]`;
      if (s.npcId) ref("quests", w, "npc", s.npcId, npcs);
      if (s.mapId) ref("quests", w, "map", s.mapId, maps);
      if (s.mobId) ref("quests", w, "monster", s.mobId, monsters);
      if (s.itemId) ref("quests", w, "item", s.itemId, items);
    });
    q.rewards.items?.forEach((it) => ref("quests", `${q.id}.rewards`, "item", it.itemId, items));
    q.videoIds?.forEach((v) => ref("quests", `${q.id}.videoIds`, "video", v, videos));
  }
  for (const s of pack.trainingSpots) {
    ref("trainingSpots", `${s.id}.mapId`, "map", s.mapId, maps);
    s.mobIds.forEach((m) => ref("trainingSpots", `${s.id}.mobIds`, "monster", m, monsters));
    s.videoIds.forEach((v) => ref("trainingSpots", `${s.id}.videoIds`, "video", v, videos));
  }
  for (const g of pack.gearProgression) ref("gearProgression", g.id, "item", g.itemId, items);
  for (const a of pack.meta.jobAdvancements) {
    ref("meta", "jobAdvancements", "job", a.from, jobs);
    a.to.forEach((t) => ref("meta", "jobAdvancements", "job", t, jobs));
    if (a.npcId) ref("meta", "jobAdvancements", "npc", a.npcId, npcs);
  }
  for (const j of pack.jobs) if (j.parent) ref("jobs", j.id, "job", j.parent, jobs);

  if (opts.level === "integrity") return issues;

  // ---- Rules 3–6: provenance ----
  const today = now.toISOString().slice(0, 10);
  const future = (d: string) => d.slice(0, 10) > today;
  type Prov = { sources: Source[]; confidence: string; verifiedAt: string };
  const provenance: [PackKey, string, Prov][] = [
    ["meta", "meta", pack.meta],
    ...pack.jobs.map((r) => ["jobs", r.id, r] as [PackKey, string, Prov]),
    ...pack.unlockables.regions.map((r) => ["unlockables", `regions.${r.id}`, r] as [PackKey, string, Prov]),
    ...pack.unlockables.bosses.map((r) => ["unlockables", `bosses.${r.id}`, r] as [PackKey, string, Prov]),
    ...pack.unlockables.partyQuests.map((r) => ["unlockables", `partyQuests.${r.id}`, r] as [PackKey, string, Prov]),
    ...pack.unlockables.crafting.map((r) => ["unlockables", `crafting.${r.id}`, r] as [PackKey, string, Prov]),
    ...pack.unlockables.citizenship.towns.map((r) => ["unlockables", `citizenship.${r.id}`, r] as [PackKey, string, Prov]),
    ...pack.events.map((r) => ["events", r.id, r] as [PackKey, string, Prov]),
    ...pack.gearProgression.map((r) => ["gearProgression", r.id, r] as [PackKey, string, Prov]),
    ...pack.skills.map((r) => ["skills", r.id, r] as [PackKey, string, Prov]),
    ...pack.items.map((r) => ["items", r.id, r] as [PackKey, string, Prov]),
    ...pack.maps.map((r) => ["maps", r.id, r] as [PackKey, string, Prov]),
    ...pack.monsters.map((r) => ["monsters", r.id, r] as [PackKey, string, Prov]),
    ...pack.drops.map((r) => ["drops", `${r.mobId}→${r.itemId}`, r] as [PackKey, string, Prov]),
    ...pack.npcs.map((r) => ["npcs", r.id, r] as [PackKey, string, Prov]),
    ...pack.quests.map((r) => ["quests", r.id, r] as [PackKey, string, Prov]),
    ...pack.trainingSpots.map((r) => ["trainingSpots", r.id, r] as [PackKey, string, Prov]),
    ...pack.apBuilds.map((r) => ["apBuilds", r.id, r] as [PackKey, string, Prov]),
  ];
  for (const [key, where, p] of provenance) {
    if (future(p.verifiedAt)) add(3, key, where, `verifiedAt ${p.verifiedAt} is in the future`);
    for (const s of p.sources) if (future(s.retrievedAt)) add(3, key, where, `source retrievedAt ${s.retrievedAt} is in the future`);
    const strong = p.sources.some((s) => s.kind === "official" || s.kind === "in-game");
    if (p.confidence === "verified" && !strong) add(4, key, where, `"verified" needs an official or in-game source`);
    const legacyOnly = p.sources.every((s) => s.kind === "legacy");
    if (legacyOnly && p.confidence !== "unverified") add(6, key, where, `legacy-only sources must be "unverified"`);
  }
  for (const s of pack.formulas.sources) if (future(s.retrievedAt)) add(3, "formulas", "sources", `retrievedAt ${s.retrievedAt} is in the future`);
  for (const d of pack.drops) {
    const w = `${d.mobId}→${d.itemId}`;
    if (d.rate.kind === "exact" && !d.sources.some((s) => s.kind === "official")) add(5, "drops", w, "an exact rate needs an official source");
    if (d.sources.every((s) => s.kind === "legacy") && d.status !== "legacy-unverified")
      add(6, "drops", w, `a legacy-only drop must have status "legacy-unverified"`);
  }

  // ---- Rule 7: sane numbers ----
  for (const m of pack.monsters)
    if (m.level > pack.meta.levelCap + 30) add(7, "monsters", m.id, `level ${m.level} is above levelCap + 30`);
  for (const s of pack.trainingSpots)
    s.bands.forEach((b, i) => b.min > b.max && add(7, "trainingSpots", `${s.id}.bands[${i}]`, `min ${b.min} > max ${b.max}`));
  for (const q of pack.quests)
    if (q.maxLevel !== undefined && q.maxLevel < q.minLevel) add(7, "quests", q.id, `maxLevel < minLevel`);

  // ---- Rule 8: portals are two-way unless marked one-way ----
  const byMap = new Map(pack.maps.map((m) => [m.id, m]));
  for (const m of pack.maps)
    for (const l of m.links) {
      if (l.kind !== "portal" || /one-way/i.test(l.note ?? "")) continue;
      const back = byMap.get(l.to)?.links.some((x) => x.to === m.id && x.kind === "portal");
      if (byMap.has(l.to) && !back) add(8, "maps", `${m.id}→${l.to}`, `portal has no way back (add it, or note "one-way")`);
    }

  // ---- Rule 9: a spot's monsters spawn on its map ----
  for (const s of pack.trainingSpots) {
    const map = byMap.get(s.mapId);
    if (!map) continue;
    for (const mob of s.mobIds)
      if (!map.spawns.some((sp) => sp.mobId === mob)) add(9, "trainingSpots", s.id, `"${mob}" has no spawn on map "${s.mapId}"`);
  }

  // ---- Rule 10: event windows ----
  for (const e of pack.events)
    e.windows.forEach((w, i) => {
      if (w.endUtc !== null && !(Date.parse(w.startUtc) < Date.parse(w.endUtc)))
        add(10, "events", `${e.id}.windows[${i}]`, "startUtc must be before endUtc");
    });

  // ---- Rule 11: regions ----
  const avail = new Set(pack.meta.regionsAvailable);
  for (const g of pack.meta.gatedRegions) if (!avail.has(g)) add(11, "meta", "gatedRegions", `"${g}" is not in regionsAvailable`);
  for (const m of pack.maps) if (!avail.has(m.region)) add(11, "maps", m.id, `region "${m.region}" is not in meta.regionsAvailable`);

  // ---- Rule 15 (added 2026-10-05): AP build phases are ordered, in range and don't overlap ----
  for (const b of pack.apBuilds) {
    const phases = [...b.phases].sort((x, y) => x.fromLevel - y.fromLevel);
    phases.forEach((ph, i) => {
      if (ph.toLevel !== undefined && ph.toLevel < ph.fromLevel) add(15, "apBuilds", b.id, `phase ${i}: toLevel < fromLevel`);
      if (ph.fromLevel > pack.meta.levelCap) add(15, "apBuilds", b.id, `phase ${i}: fromLevel above levelCap`);
      const next = phases[i + 1];
      if (next && (ph.toLevel === undefined || ph.toLevel >= next.fromLevel)) add(15, "apBuilds", b.id, `phase ${i} overlaps phase ${i + 1}`);
    });
  }

  // ---- Rule 12: skills ----
  for (const s of pack.skills)
    s.levels?.forEach((l) => l.level > s.maxLevel && add(12, "skills", s.id, `level ${l.level} > maxLevel ${s.maxLevel}`));

  // ---- Rule 13: MeowDB ids only ----
  const withExt: [PackKey, { id: string; ext?: { meowdb?: string } }[]][] = [
    ["monsters", pack.monsters],
    ["maps", pack.maps],
    ["items", pack.items],
    ["npcs", pack.npcs],
    ["quests", pack.quests],
    ["skills", pack.skills],
  ];
  for (const [key, list] of withExt)
    for (const r of list)
      if (r.ext?.meowdb !== undefined && !/^[0-9]{1,12}$/.test(r.ext.meowdb))
        add(13, key, r.id, `ext.meowdb must be a numeric id seen in the address bar, got "${r.ext.meowdb}"`);

  // ---- Rule 14 (added 2026-10-05): focus weight rows sum to 1 ----
  for (const [focus, row] of Object.entries(pack.focusProfiles)) {
    const sum = Object.values(row).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-9) add(14, "focusProfiles", focus, `weights sum to ${sum}, not 1`);
  }

  return issues;
}

export function formatIssue(i: Issue): string {
  return `rule ${i.rule} · ${i.file} · ${i.where}: ${i.message}`;
}
