import { z } from "zod";
import { FOCUS_IDS, JOB_IDS } from "./profile";
import { NewsRulesSchema } from "../../features/news/schema";

// Plan §8.5 — datapack record schemas. Every game fact carries provenance (D-8).

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "ids are lower-case kebab-case");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z)?$/, "expected YYYY-MM-DD or an ISO UTC time");
const utc = z.iso.datetime();
const jobId = z.enum(JOB_IDS);
const posInt = z.number().int().min(0);

export const ConfidenceSchema = z.enum(["verified", "likely", "unverified"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const SourceSchema = z.object({
  kind: z.enum(["official", "in-game", "community", "legacy"]),
  label: z.string().min(1),
  url: z.url().optional(),
  articleId: z.number().int().positive().optional(),
  retrievedAt: isoDate,
});
export type Source = z.infer<typeof SourceSchema>;

export const ProvenanceShape = {
  sources: z.array(SourceSchema).min(1, "every record needs at least one source"),
  confidence: ConfidenceSchema,
  verifiedAt: isoDate,
};

/** `ext.meowdb` holds an id only (rule 13) — the UI builds the deep link. */
export const ExtSchema = z.object({ meowdb: z.string().optional() }).strict();

export const JobAdvancementSchema = z.object({
  level: z.number().int().min(1),
  from: jobId,
  to: z.array(jobId).min(1),
  npcId: z.string().optional(), // optional: not every instructor is in the official notes yet (§15)
});

export const MetaSchema = z.object({
  packVersion: z.string().regex(/^\d{4}\.\d{2}\.\d{2}-\d+$/, 'packVersion must look like "2026.10.07-1"'),
  gameLabel: z.string().min(1),
  /** The label stops showing at this instant (e.g. "Founder's Access" ends at Grand Launch). */
  gameLabelUntilUtc: utc.optional(),
  levelCap: z.number().int().min(1).max(300),
  charactersPerAccount: z.number().int().min(1),
  jobAdvancements: z.array(JobAdvancementSchema),
  regionsAvailable: z.array(id).min(1),
  gatedRegions: z.array(id),
  defaultRespawnSec: z.number().positive().nullable(),
  reviewedThroughArticleId: z.number().int().positive(),
  reviewedAt: isoDate,
  ...ProvenanceShape,
});

export const JobSchema = z.object({
  id: jobId,
  name: z.string().min(1),
  family: z.enum(["beginner", "warrior", "magician", "bowman", "thief"]),
  tier: z.number().int().min(0).max(4),
  parent: jobId.nullable(),
  advanceLevel: z.number().int().min(1),
  archetype: z.enum(["melee", "ranged", "mage"]),
  instructor: z.string().optional(),
  town: z.string().optional(),
  ...ProvenanceShape,
});

const Named = { id, name: z.string().min(1), ...ProvenanceShape };
export const UnlockablesSchema = z.object({
  regions: z.array(z.object(Named)),
  bosses: z.array(z.object(Named)),
  partyQuests: z.array(z.object({ ...Named, town: z.string(), minLevel: z.number().int().min(1), finalBoss: z.string().optional() })),
  crafting: z.array(z.object({ ...Named, npc: z.string(), minLevel: z.number().int().min(1) })),
  citizenship: z.object({
    minLevel: z.number().int().min(1),
    towns: z.array(z.object({ id: z.enum(["henesys", "kerning"]), name: z.string(), npc: z.string(), place: z.string(), ...ProvenanceShape })),
  }),
});

export const MonsterSchema = z.object({
  id,
  name: z.string().min(1),
  level: z.number().int().min(1),
  hp: posInt,
  exp: posInt,
  mp: posInt.optional(),
  touchDmgMin: posInt.optional(),
  touchDmgMax: posInt.optional(),
  pdef: posInt.optional(),
  mdef: posInt.optional(),
  accuracy: posInt.optional(),
  avoid: posInt.optional(),
  boss: z.boolean(),
  undead: z.boolean().optional(),
  weak: z.array(z.string()).optional(),
  strong: z.array(z.string()).optional(),
  mesoMin: posInt.optional(),
  mesoMax: posInt.optional(),
  image: z.url().optional(),
  ext: ExtSchema.optional(),
  ...ProvenanceShape,
});

export const MapSchema = z.object({
  id,
  name: z.string().min(1),
  region: id,
  isTown: z.boolean(),
  /** `count` is optional: fan sources rarely publish exact spawn counts (engine then weights mobs equally). */
  spawns: z.array(z.object({ mobId: id, count: z.number().int().min(1).optional(), respawnSec: z.number().positive().optional() })),
  links: z.array(
    z.object({
      to: id,
      kind: z.enum(["portal", "taxi", "ship", "hidden"]),
      costMeso: posInt.optional(),
      note: z.string().optional(),
      /** Where the portal sits on the map picture, in % across (x) and down (y). */
      pos: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).optional(),
    }),
  ),
  npcIds: z.array(id),
  hasPotionShop: z.boolean().optional(),
  image: z.url().optional(),
  ext: ExtSchema.optional(),
  ...ProvenanceShape,
});

export const TIERS = ["common", "uncommon", "rare", "very-rare"] as const;
export const ItemSchema = z.object({
  id,
  name: z.string().min(1),
  category: z.enum(["equip", "use", "etc", "setup", "cash"]),
  slot: z.string().optional(),
  weaponType: z.string().optional(),
  reqLevel: z.number().int().min(0).optional(),
  reqJobs: z.array(z.enum(["warrior", "magician", "bowman", "thief", "beginner"])).optional(),
  stats: z.record(z.string(), z.number()).optional(),
  /** Minimum stats needed to equip (e.g. { dex: 60 }). */
  reqStats: z.object({ str: posInt, dex: posInt, int: posInt, luk: posInt }).partial().optional(),
  npcSellMeso: posInt.optional(),
  tags: z.array(z.string()),
  rarity: z.enum(TIERS).optional(),
  image: z.url().optional(),
  ext: ExtSchema.optional(),
  ...ProvenanceShape,
});

export const RateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), pct: z.number().gt(0).max(100) }),
  z.object({ kind: z.literal("sampled"), drops: posInt, kills: z.number().int().min(1) }),
  z.object({ kind: z.literal("tier"), tier: z.enum(TIERS) }),
  z.object({ kind: z.literal("unknown") }),
]);
export const DropSchema = z.object({
  mobId: id,
  itemId: id,
  status: z.enum(["confirmed", "reported", "legacy-unverified"]),
  rate: RateSchema,
  ...ProvenanceShape,
});

export const NpcSchema = z.object({
  id,
  name: z.string().min(1),
  mapId: id,
  role: z.string().optional(),
  image: z.url().optional(),
  ext: ExtSchema.optional(),
  ...ProvenanceShape,
});

export const QuestStepSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(["talk", "kill", "collect", "travel", "deliver"]),
  npcId: id.optional(),
  mapId: id.optional(),
  mobId: id.optional(),
  itemId: id.optional(),
  qty: z.number().int().min(1).optional(),
});
export const QuestSchema = z.object({
  id,
  name: z.string().min(1),
  category: z.enum(["regular", "job", "citizenship", "event", "party"]),
  minLevel: z.number().int().min(1),
  maxLevel: z.number().int().min(1).optional(),
  jobs: z.array(jobId).optional(),
  prereqQuestIds: z.array(id),
  startNpcId: id,
  steps: z.array(QuestStepSchema),
  rewards: z.object({
    exp: posInt.optional(),
    meso: posInt.optional(),
    fame: z.number().int().optional(),
    items: z.array(z.object({ itemId: id, qty: z.number().int().min(1), choice: z.boolean().optional() })).optional(),
  }),
  missable: z.boolean().optional(),
  repeatable: z.boolean().optional(),
  chainId: id.optional(),
  chainIndex: z.number().int().min(0).optional(),
  availableFromUtc: utc.optional(),
  availableUntilUtc: utc.optional(),
  videoIds: z.array(z.string()).optional(),
  ext: ExtSchema.optional(),
  ...ProvenanceShape,
});

export const TrainingSpotSchema = z.object({
  id,
  mapId: id,
  mobIds: z.array(id).min(1),
  bands: z
    .array(
      z.object({
        archetype: z.enum(["melee", "ranged", "mage", "any"]),
        jobs: z.array(jobId).optional(),
        min: z.number().int().min(1),
        max: z.number().int().min(1),
      }),
    )
    .min(1),
  party: z.enum(["solo", "party", "either"]),
  /** Optional: only set when a source reports it (never guessed). Not used for scoring. */
  popularity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  mobilitySec: z.number().min(0).optional(),
  notes: z.string(),
  safeSpot: z.string().optional(),
  potionAdvice: z.string().optional(),
  tags: z.array(z.string()),
  videoIds: z.array(z.string()),
  ...ProvenanceShape,
});

export const SkillSchema = z.object({
  id,
  name: z.string().min(1),
  jobId,
  maxLevel: z.number().int().min(1).max(30),
  kind: z.enum(["attack", "buff", "passive", "other"]),
  levels: z
    .array(
      z.object({
        level: z.number().int().min(1),
        damagePct: z.number().min(0).optional(),
        hits: z.number().int().min(1).optional(),
        targets: z.number().int().min(1).optional(),
        mpCost: posInt.optional(),
      }),
    )
    .optional(),
  image: z.url().optional(),
  ext: ExtSchema.optional(),
  ...ProvenanceShape,
});

export const VideoSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{11}$/, "YouTube ids are 11 characters"),
  title: z.string().min(1),
  channel: z.string().min(1),
  lang: z.string().min(2),
  topics: z.array(z.object({ kind: z.enum(["spot", "quest", "job", "boss", "pq", "general"]), refId: z.string().optional() })),
  appliesTo: z.string().min(1),
  addedAt: isoDate,
  lastCheckedAt: isoDate,
  status: z.enum(["ok", "removed"]),
});

export const GameEventSchema = z.object({
  id,
  title: z.string().min(1),
  kind: z.enum(["event", "gm-event", "sale", "deadline"]),
  /** For a deadline or a one-off moment, `startUtc` is the instant and `endUtc` is null. */
  windows: z.array(z.object({ startUtc: utc, endUtc: utc.nullable() })).min(1),
  minLevel: z.number().int().min(1).optional(),
  howTo: z.string(),
  rewards: z.string(),
  articleId: z.number().int().positive(),
  articleHash: z.string().regex(/^[0-9a-f]{64}$/, "articleHash is a SHA-256 hex digest"),
  ...ProvenanceShape,
});

const SUBSCORES = ["exp", "meso", "drop", "equip", "safety", "convenience"] as const;
const WeightRow = z.object(Object.fromEntries(SUBSCORES.map((k) => [k, z.number().min(0).max(1)])) as Record<(typeof SUBSCORES)[number], z.ZodNumber>);
export const FocusProfilesSchema = z.object(
  Object.fromEntries(FOCUS_IDS.map((f) => [f, WeightRow])) as Record<(typeof FOCUS_IDS)[number], typeof WeightRow>,
);

export const FormulasSchema = z.object({
  expToNext: z.array(posInt).nullable(),
  levelPenalty: z.object({ verified: z.boolean(), table: z.array(z.object({ diff: z.number().int(), mult: z.number().min(0) })) }).nullable(),
  hitChance: z.object({ verified: z.boolean(), kind: z.string(), params: z.record(z.string(), z.number()) }).nullable(),
  defaultAttackIntervalSec: z.number().positive(),
  aoeEfficiency: z.number().min(0).max(1),
  tierWeights: z.object({
    common: z.number().min(0),
    uncommon: z.number().min(0),
    rare: z.number().min(0),
    "very-rare": z.number().min(0),
    unknown: z.number().min(0),
  }),
  sources: z.array(SourceSchema),
  notes: z.string().optional(),
});

export const GearEntrySchema = z.object({
  id,
  family: z.enum(["beginner", "warrior", "magician", "bowman", "thief", "any"]),
  slot: z.string().min(1),
  itemId: id,
  level: z.number().int().min(0),
  how: z.array(z.enum(["drop", "craft", "shop", "quest"])).min(1),
  note: z.string().optional(),
  ...ProvenanceShape,
});

export const STAT_KEYS = ["str", "dex", "int", "luk"] as const;
const statKey = z.enum(STAT_KEYS);
/** A stat target for a phase: `base + perLevel × level` (either part optional, e.g. "DEX = level × 2"). */
const StatTarget = z.object({ base: z.number().optional(), perLevel: z.number().optional() }).refine((t) => t.base !== undefined || t.perLevel !== undefined, "target needs base and/or perLevel");

/** Where to put ability points (AP) for a class, by level range (the owner request 2026-10-05). */
export const ApBuildSchema = z.object({
  id,
  name: z.string().min(1),
  jobs: z.array(jobId).min(1),
  /** Shown first when several builds fit the character. */
  recommended: z.boolean().optional(),
  summary: z.string().min(1),
  phases: z
    .array(
      z.object({
        fromLevel: z.number().int().min(1),
        toLevel: z.number().int().min(1).optional(),
        /** Where every point not needed for a target goes. */
        primary: statKey,
        /** Stats to keep topped up to a target first (e.g. DEX for accuracy or equipment). */
        targets: z.partialRecord(statKey, StatTarget).optional(),
        text: z.string().min(1),
      }),
    )
    .min(1),
  ...ProvenanceShape,
});
export type ApBuild = z.infer<typeof ApBuildSchema>;

/** The assembled pack: one JSON file per key (file name in `PACK_FILES`). */
export const PackDataSchema = z.object({
  meta: MetaSchema,
  formulas: FormulasSchema,
  focusProfiles: FocusProfilesSchema,
  jobs: z.array(JobSchema),
  unlockables: UnlockablesSchema,
  events: z.array(GameEventSchema),
  videos: z.array(VideoSchema),
  gearProgression: z.array(GearEntrySchema),
  skills: z.array(SkillSchema),
  items: z.array(ItemSchema),
  maps: z.array(MapSchema),
  monsters: z.array(MonsterSchema),
  drops: z.array(DropSchema),
  npcs: z.array(NpcSchema),
  quests: z.array(QuestSchema),
  trainingSpots: z.array(TrainingSpotSchema),
  apBuilds: z.array(ApBuildSchema),
  newsRules: NewsRulesSchema,
});
export type PackData = z.infer<typeof PackDataSchema>;
export type PackKey = keyof PackData;
export type Monster = z.infer<typeof MonsterSchema>;
export type GameMap = z.infer<typeof MapSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Drop = z.infer<typeof DropSchema>;
export type Rate = z.infer<typeof RateSchema>;
export type Npc = z.infer<typeof NpcSchema>;
export type Quest = z.infer<typeof QuestSchema>;
export type TrainingSpot = z.infer<typeof TrainingSpotSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type Video = z.infer<typeof VideoSchema>;
export type GameEvent = z.infer<typeof GameEventSchema>;
export type Formulas = z.infer<typeof FormulasSchema>;
export type Meta = z.infer<typeof MetaSchema>;

/** Built (flat) file name for each pack key. `pack_read` only allows `^[a-z0-9.-]+\.json$`. */
export const PACK_FILES: Record<PackKey, string> = {
  meta: "meta.json",
  formulas: "formulas.json",
  focusProfiles: "focus-profiles.json",
  jobs: "jobs.json",
  unlockables: "unlockables.json",
  events: "events.json",
  videos: "videos.json",
  gearProgression: "gear-progression.json",
  skills: "skills.json",
  items: "items.json",
  maps: "maps.json",
  monsters: "monsters.json",
  drops: "drops.json",
  npcs: "npcs.json",
  quests: "quests.json",
  trainingSpots: "training-spots.json",
  apBuilds: "ap-builds.json",
  newsRules: "news-rules.json",
};
