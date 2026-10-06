import { z } from "zod";

// Plan §8.4, written for zod 4: object-level defaults use `.prefault({})` so inner defaults fill in.

export const JOB_IDS = [
  "beginner",
  "warrior",
  "fighter",
  "page",
  "spearman",
  "magician",
  "wizard-fp",
  "wizard-il",
  "cleric",
  "bowman",
  "hunter",
  "crossbowman",
  "thief",
  "assassin",
  "bandit",
] as const;
export const FOCUS_IDS = ["exp", "rare-drop", "class-equip", "meso", "balanced"] as const;
export type JobId = (typeof JOB_IDS)[number];
export type FocusId = (typeof FOCUS_IDS)[number];

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const iso = z.iso.datetime();
const count = z.number().int().min(0).max(1e12);

function ObservationSchema() {
  return z.object({
    minutes: z.number().min(0).max(1e7),
    kills: count,
    exp: count,
    meso: count,
    killsByMob: z.record(z.string(), count).default({}),
    items: z.record(z.string(), count).default({}),
    /** % of a level gained (status bar), and the minutes it was measured over. */
    levelPercent: z.number().min(0).max(1e6).default(0),
    levelPercentMinutes: z.number().min(0).max(1e7).default(0),
    sessions: int(0, 1e6),
    lastAt: iso,
  });
}
export type Observation = z.infer<ReturnType<typeof ObservationSchema>>;

function TrainingRunSchema() {
  return z.object({
    startedAt: iso,
    endedAt: iso,
    /** Spot id, or `map:<id>` on a map with no guide spot. */
    key: z.string(),
    level: int(1, 300).nullable(),
    minutes: z.number().min(0).max(1e6),
    kills: count,
    exp: count,
    meso: count,
    items: z.record(z.string(), count).default({}),
    /** % of a level gained during this stretch, when the status bar was readable. */
    levelPercent: z.number().min(0).max(1e6).nullable(),
  });
}
export type TrainingRun = z.infer<ReturnType<typeof TrainingRunSchema>>;

/** I-29: a region of the game window, in the window's real pixels. */
export const RegionSchema = z.object({ x: int(0, 20000), y: int(0, 20000), w: int(4, 4000), h: int(4, 4000) });
export type Region = z.infer<typeof RegionSchema>;

export const ProfileSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(24),
  createdAt: iso,
  updatedAt: iso,
  jobId: z.enum(JOB_IDS),
  level: int(1, 300), // UI clamps to pack.meta.levelCap (100 today)
  expPercent: z.number().min(0).max(100).nullable().default(null),
  focus: z.enum(FOCUS_IDS).default("balanced"),
  stats: z
    .object({
      str: int(0, 9999),
      dex: int(0, 9999),
      int: int(0, 9999),
      luk: int(0, 9999),
      hp: int(0, 99999),
      mp: int(0, 99999),
    })
    .partial()
    .prefault({}),
  combat: z
    .object({
      damageMin: int(0, 999999),
      damageMax: int(0, 999999),
      accuracy: int(0, 9999),
      avoid: int(0, 9999),
      weaponType: z.string().max(32),
      mainSkillId: z.string().max(64),
    })
    .partial()
    .prefault({}),
  skills: z.record(z.string(), int(0, 30)).default({}),
  unlocks: z
    .object({
      areas: z.array(z.string()).default([]),
      questsDone: z.array(z.string()).default([]),
      questsActive: z.array(z.string()).default([]),
      bossesDefeated: z.array(z.string()).default([]),
      partyQuests: z.array(z.string()).default([]),
      citizenship: z
        .object({ town: z.enum(["henesys", "kerning"]), grade: int(0, 99) })
        .nullable()
        .default(null),
      crafting: z.record(z.string(), int(0, 999)).default({}),
    })
    .prefault({}),
  wishlistItemIds: z.array(z.string()).default([]),
  skippedSpots: z.array(z.object({ spotId: z.string(), until: iso })).default([]),
  screenshot: z.object({ file: z.string(), updatedAt: iso }).nullable().default(null),
  lastView: z.string().default("/home"),
  notes: z.string().max(4000).default(""),
  archived: z.boolean().default(false),
  /** I-20: the character's measured levelling pace (% of the current level per hour). */
  pace: z
    .object({ percentPerHour: z.number().positive().max(100000), level: int(1, 300), measuredAt: iso, minutes: z.number().positive() })
    .nullable()
    .default(null),
  /** I-20: a running "measure my pace" timer, kept across restarts. */
  paceTimer: z.object({ startedAt: iso, startExpPercent: z.number().min(0).max(100), level: int(1, 300) }).nullable().default(null),
  /** P6-T2: ticked quest steps (indexes) per quest id. */
  questSteps: z.record(z.string(), z.array(int(0, 99))).default({}),
  /** I-29: what the screen watcher saw, summed per training spot (only while the owner had it switched on). */
  observations: z.record(z.string(), ObservationSchema()).default({}),
  /** I-34: one row per watched stretch at a map (newest last, capped at TRAINING_LOG_MAX). */
  trainingLog: z.array(TrainingRunSchema()).default([]),
});

export const TRAINING_LOG_MAX = 500;
export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileInput = z.input<typeof ProfileSchema>;

/** Window geometry in logical pixels (replaces the window-state plugin; §15). */
export const WindowGeometrySchema = z.object({
  width: z.number().min(200).max(10000),
  height: z.number().min(200).max(10000),
  x: z.number().min(-20000).max(20000),
  y: z.number().min(-20000).max(20000),
  maximized: z.boolean(),
});
export type WindowGeometry = z.infer<typeof WindowGeometrySchema>;

export const SettingsSchema = z
  .object({
    timeZoneMode: z.enum(["sydney", "system"]).default("sydney"),
    motion: z.enum(["system", "full", "reduced"]).default("system"),
    theme: z.enum(["system", "day", "night"]).default("system"),
    window: WindowGeometrySchema.nullable().default(null),
    /** I-26: Windows notifications shortly before events and deadlines. */
    reminders: z
      .object({
        enabled: z.boolean().default(true),
        leadMinutes: z.number().int().min(1).max(240).default(15),
        muted: z.array(z.string()).default([]),
      })
      .prefault({}),
    /** I-33: the global watch on/off key (≥ 1 modifier + a letter/digit/F-key). */
    hotkey: z.string().min(3).max(40).default("Ctrl+Shift+K"),
    /** I-29 setup. Deliberately no "on" flag: the watcher is off at every launch. */
    watch: z
      .object({
        windowTitle: z.string().max(256),
        sourceWidth: int(1, 20000),
        sourceHeight: int(1, 20000),
        status: RegionSchema.nullable(),
        chat: RegionSchema.nullable(),
        /** The minimap's title box; lets the watcher follow the player from map to map. */
        map: RegionSchema.nullable().default(null),
        intervalSec: z.number().min(1).max(30).default(2),
        /** I-44: write recognised text + decisions to field-notes\watch-log\ (never pixels) for tuning. */
        diagnostics: z.boolean().default(false),
        /** How the game draws text: "pixel" enlarges without smoothing, which suits Classic's bitmap font. */
        textStyle: z.enum(["smooth", "pixel"]).default("smooth"),
        savedAt: iso,
      })
      .nullable()
      .default(null),
  })
  .prefault({});
export type Settings = z.infer<typeof SettingsSchema>;

export const PROFILES_SCHEMA_VERSION = 1;

export const ProfilesFileSchema = z.object({
  schemaVersion: z.literal(PROFILES_SCHEMA_VERSION),
  activeProfileId: z.uuid().nullable(),
  profiles: z.array(ProfileSchema),
  settings: SettingsSchema,
});
export type ProfilesFile = z.infer<typeof ProfilesFileSchema>;

export function emptyProfilesFile(): ProfilesFile {
  return ProfilesFileSchema.parse({
    schemaVersion: 1,
    activeProfileId: null,
    profiles: [],
    settings: {},
  });
}
