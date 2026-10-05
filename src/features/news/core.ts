import type { Article, ArticleType } from "./schema";

// Ported from Astra `app/core.mjs` (plan P7-T1, Appendix B). Behaviour is kept identical except:
//  * `hash` / `normalize` are async (Web Crypto instead of Node `crypto`);
//  * `Article.source` is called `url`;
//  * `plainText` no longer resolves `&constructor;`-style entities through Object.prototype.
// Everything fetched from Nexon is treated as untrusted text: it is parsed, validated and rendered
// as plain text. Nothing in this file produces HTML.

export const API = "https://g.nexonstatic.com/maplestory/cms/v1";

export const CLASSIC = /\b(?:maple\s*story\s+classic(?:\s+world)?|classic\s+world|MSCW)\b/i;

/** SHA-256 hex of a string, or of `JSON.stringify(value)` for anything else. */
export async function hash(value: unknown): Promise<string> {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof text !== "string") throw new TypeError("hash: value cannot be serialised to JSON.");
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto (crypto.subtle) is not available in this context.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------------------------
// Types for what Nexon sends
// ---------------------------------------------------------------------------------------------

/** An item of `/news` or `/archived` (no body), or an article from `/news/{id}` (with body). */
export interface NexonItem {
  id: number;
  name: string;
  category: string;
  liveDate: string;
  summary?: string | null;
  body?: string | null;
  isMSCW?: boolean | null;
  featured?: boolean | null;
  imageThumbnail?: string | null;
}

/** What `matchReason` looks at; also satisfied by a `NexonItem`. */
export interface MatchInput {
  name?: string | null;
  summary?: string | null;
  body?: string | null;
  isMSCW?: boolean | null;
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

// Parse visible text only. Scripts, styles and HTML attributes are never executed.
const entities: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  bull: "•",
  times: "×",
  copy: "©",
  reg: "®",
};

export function plainText(html: unknown = ""): string {
  return String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|tr|summary|details|ul|ol|section)>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, " / ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (raw: string, key: string) => {
      if (key[0] !== "#") {
        const name = key.toLowerCase();
        return Object.hasOwn(entities, name) ? (entities[name] ?? raw) : raw;
      }
      const n = key[1]?.toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    })
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

export function classify(item: { name: string; category?: string | null }): ArticleType {
  const title = item.name.toLowerCase();
  if (/release notes|patch notes|content update/.test(title) || item.category === "update")
    return "Update";
  if (/known issues/.test(title)) return "Known issues";
  if (item.category === "maintenance" || /maintenance/.test(title)) return "Maintenance";
  if (item.category === "sale" || /packages.*sale/.test(title)) return "Sale";
  if (
    item.category === "events" ||
    item.category === "event" ||
    /event|giveaway|sign.?up|sign ups/.test(title)
  )
    return "Event / sign-up";
  if (/instructions|purchase guide|faq/.test(title)) return "Guide / FAQ";
  return "Notice";
}

export function matchReason(item: MatchInput): string | null {
  if (item.isMSCW === true) return "Nexon Classic tag";
  if (CLASSIC.test(plainText(item.name) + " " + plainText(item.summary)))
    return "Classic named in title / summary";
  if (CLASSIC.test(plainText(item.body))) return "Classic mentioned in article";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/** Throws on anything unexpected; returns the same object, typed. `detail` also requires a body. */
export function validateItem(item: unknown, detail = false): NexonItem {
  if (typeof item !== "object" || item === null)
    throw new Error("Invalid article ID in Nexon response.");
  const rec = item as Record<string, unknown>;
  const id = rec.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
    throw new Error("Invalid article ID in Nexon response.");
  for (const field of ["name", "category", "liveDate"] as const) {
    const value = rec[field];
    if (typeof value !== "string" || !value.trim())
      throw new Error(`Article ${id}: missing ${field}.`);
  }
  const category = rec.category as string;
  const liveDate = rec.liveDate as string;
  if (!/^[a-z][a-z0-9-]*$/i.test(category)) throw new Error(`Article ${id}: unexpected category.`);
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(liveDate) ||
    !Number.isFinite(Date.parse(liveDate))
  )
    throw new Error(`Article ${id}: invalid publication timestamp.`);
  if (rec.isMSCW != null && typeof rec.isMSCW !== "boolean")
    throw new Error(`Article ${id}: Classic tag changed format.`);
  if (detail && (typeof rec.body !== "string" || !rec.body.trim()))
    throw new Error(`Article ${id}: empty article body.`);
  return item as NexonItem;
}

// ---------------------------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------------------------

/** Only what `normalize` needs from the previous version of an article. */
export type PreviousArticle = Pick<Article, "firstSeen" | "lastChanged" | "contentHash">;

/**
 * Turns an article (`detail`) plus its index entry (`feed`) into an `Article`, or `null` when it is
 * not Classic World news. `contentHash` is byte-for-byte Astra's: SHA-256 of
 * `JSON.stringify({name, category, liveDate, summary (plain), body (RAW), isMSCW})` in that key order.
 */
export async function normalize(
  detail: NexonItem,
  feed: NexonItem & { feed?: "news" | "archived" },
  now: string,
  old?: PreviousArticle | null,
): Promise<Article | null> {
  const body = plainText(detail.body);
  const summary = plainText(detail.summary || feed.summary);
  const reason = matchReason(detail) || matchReason(feed);
  if (!reason) return null;
  const contentHash = await hash({
    name: detail.name,
    category: detail.category,
    liveDate: detail.liveDate,
    summary,
    body: detail.body,
    isMSCW: detail.isMSCW,
  });
  const article: Article = {
    id: detail.id,
    title: plainText(detail.name),
    category: detail.category,
    type: classify(detail),
    publishedUTC: detail.liveDate,
    summary,
    body,
    url: `https://www.nexon.com/maplestory/news/${detail.category.toLowerCase()}/${detail.id}`,
    reason,
    tagged: detail.isMSCW === true || feed.isMSCW === true,
    contentHash,
    firstSeen: old?.firstSeen || now,
    lastChanged: old?.contentHash === contentHash ? old.lastChanged : now,
    checkedAt: now,
    change: !old ? "New" : old.contentHash !== contentHash ? "Updated" : "Unchanged",
    availability: "Verified",
  };
  if (feed.feed) article.feed = feed.feed;
  return article;
}

// ---------------------------------------------------------------------------------------------
// Date excerpts
// ---------------------------------------------------------------------------------------------

export interface DateReference {
  id: number;
  title: string;
  publishedUTC: string;
  /** The nearest preceding short line without a date (usually the heading). */
  context: string;
  /** The source line, verbatim. */
  excerpt: string;
  url: string;
  checkedAt: string;
}

/** Source excerpts only — never inferred event intervals or current event statuses. */
export function dateReferences(
  article: Pick<Article, "id" | "title" | "publishedUTC" | "body" | "url" | "checkedAt">,
): DateReference[] {
  const datePattern =
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}\b|\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}:\d{2}\s*(?:AM|PM|UTC|PDT|PST|EDT|EST|AEST|AEDT)\b/i;
  const result: DateReference[] = [];
  let context = "";
  for (const line of article.body.split("\n")) {
    if (line.length < 120 && !datePattern.test(line)) context = line.replace(/\s*\+$/, "");
    if (datePattern.test(line))
      result.push({
        id: article.id,
        title: article.title,
        publishedUTC: article.publishedUTC,
        context,
        excerpt: line,
        url: article.url,
        checkedAt: article.checkedAt,
      });
  }
  return result.filter((r, i, a) => a.findIndex((x) => x.excerpt === r.excerpt) === i);
}
