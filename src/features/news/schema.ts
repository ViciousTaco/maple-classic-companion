import { z } from "zod";

// News feature schemas (plan §6.1 Tier A, P7-T2/T4).
// Everything that crosses a trust boundary — saved cache files and the datapack's news rules — is
// parsed through one of these before use. Nothing here ever produces HTML.

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "expected a lower-case SHA-256 hex digest");
const isoUtc = z.iso.datetime();

// ---------------------------------------------------------------------------------------------
// Articles (the normalised output of the news client)
// ---------------------------------------------------------------------------------------------

export const ARTICLE_TYPES = [
  "Update",
  "Known issues",
  "Maintenance",
  "Sale",
  "Event / sign-up",
  "Guide / FAQ",
  "Notice",
] as const;
export const ArticleTypeSchema = z.enum(ARTICLE_TYPES);
export type ArticleType = z.infer<typeof ArticleTypeSchema>;

export const ArticleSchema = z.object({
  id: z.number().int().positive(),
  /** Plain text (never HTML). */
  title: z.string(),
  category: z.string(),
  type: ArticleTypeSchema,
  /** `liveDate` exactly as Nexon published it (an ISO instant). */
  publishedUTC: z.string(),
  /** Plain text. */
  summary: z.string(),
  /** Plain text. */
  body: z.string(),
  /** `https://www.nexon.com/maplestory/news/<category>/<id>` */
  url: z.string(),
  /** Why the article counts as Classic World news (`matchReason`). */
  reason: z.string(),
  /** True when Nexon's own Classic tag (`isMSCW`) is set. */
  tagged: z.boolean(),
  /** SHA-256 over the raw article fields — the value pinned by the news rules / seed events. */
  contentHash: sha256Hex,
  firstSeen: z.string(),
  lastChanged: z.string(),
  checkedAt: z.string(),
  /** Relative to the previous successful refresh; `Not listed` = Nexon dropped it from the feeds. */
  change: z.enum(["New", "Updated", "Unchanged", "Not listed"]),
  availability: z.enum(["Verified", "Not in current feeds"]),
  /** Which Nexon list it came from. */
  feed: z.enum(["news", "archived"]).optional(),
});
export type Article = z.infer<typeof ArticleSchema>;

// ---------------------------------------------------------------------------------------------
// Cache file shapes (what the client reads/writes through `NewsCache`)
// ---------------------------------------------------------------------------------------------

/** `article-<id>`: the raw `/news/{id}` response — the same shape as Astra's cache files. */
export const ArticleCacheSchema = z.object({
  data: z.unknown(),
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
  checkedAt: z.string(),
});
export type ArticleCache = z.infer<typeof ArticleCacheSchema>;

/**
 * `index-news` / `index-archived`: validators for the last good index response, how many items it
 * listed (for the shrink guard rail) and only the items that matched Classic World. The full
 * archive is thousands of items, so the rest is deliberately not stored.
 */
export const IndexCacheSchema = z.object({
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
  checkedAt: z.string(),
  count: z.number().int().nonnegative(),
  /** Index items that matched Classic World; each is re-validated with `validateItem` on read. */
  items: z.array(z.unknown()),
});
export type IndexCache = z.infer<typeof IndexCacheSchema>;

/** `news-state`: the last good result (what the UI shows offline) plus archive bookkeeping. */
export const NewsStateSchema = z.object({
  schema: z.literal(1),
  fetchedAt: z.string(),
  archiveCheckedAt: z.string().nullable(),
  articles: z.array(ArticleSchema),
});
export type NewsState = z.infer<typeof NewsStateSchema>;

// ---------------------------------------------------------------------------------------------
// Relevance rules — `datapack/news-rules.json` (P7-T4)
// ---------------------------------------------------------------------------------------------

const isTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** An article another rule depends on. If that article's hash changed, the rule no longer applies. */
export const RuleEvidenceSchema = z.object({
  id: z.number().int().positive(),
  contentHash: sha256Hex,
});

const ruleBase = {
  /** The article this rule was checked against. A different hash => "Needs review". */
  contentHash: sha256Hex,
  reason: z.string().min(1),
  source: z.url().optional(),
  evidence: z.array(RuleEvidenceSchema).default([]),
};

/** Ongoing reference: a publication date is not an expiry date. */
const KeepRuleSchema = z.object({ ...ruleBase, kind: z.literal("keep") });
/** Uncertain on purpose: stays current, flagged "Needs review". */
const ReviewRuleSchema = z.object({ ...ruleBase, kind: z.literal("review") });
/** Relevant through a calendar day in `calendarZone` (no invented end time). */
const CalendarRuleSchema = z.object({
  ...ruleBase,
  kind: z.literal("calendar"),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  calendarZone: z.string().refine(isTimeZone, "expected an IANA time zone"),
});
/** Already over because of later articles (no time component). */
const HistoricalRuleSchema = z.object({
  ...ruleBase,
  kind: z.literal("historical"),
  status: z.string().min(1).optional(),
});
/** Current until a verified UTC instant, archived after it. */
const ExpireRuleSchema = z.object({
  ...ruleBase,
  kind: z.literal("expire"),
  until: isoUtc,
  status: z.string().min(1).optional(),
  /** Shown while the article is still current (otherwise a generic line is used). */
  currentReason: z.string().min(1).optional(),
});

export const NewsRuleSchema = z.discriminatedUnion("kind", [
  KeepRuleSchema,
  ReviewRuleSchema,
  CalendarRuleSchema,
  HistoricalRuleSchema,
  ExpireRuleSchema,
]);
export type NewsRule = z.infer<typeof NewsRuleSchema>;

export const NewsRulesSchema = z.object({
  version: z.literal(1),
  reviewedAt: isoUtc,
  /** Keyed by Nexon article id. */
  articles: z.record(z.string().regex(/^\d+$/, "article ids are digits"), NewsRuleSchema),
});
export type NewsRules = z.infer<typeof NewsRulesSchema>;
