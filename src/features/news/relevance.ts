import { parseExplicitTimes } from "../../lib/sydney";
import type { Article, NewsRule } from "./schema";

// Ported from Astra `app/relevance.mjs` (plan P7-T4). Decides whether a Classic World article is still
// "current" (worth showing) or can go to the archive. The rules live in `datapack/news-rules.json`
// (`NewsRulesSchema`) and are pinned to each article's `contentHash`: if Nexon edits an article, or an
// article a rule relies on, the rule is ignored and the article falls back to "Needs review" (kept
// current, never silently hidden).

export type RelevanceBucket = "current" | "archive";

export interface RelevanceDecision {
  bucket: RelevanceBucket;
  /** Short label for a chip, e.g. "Current / upcoming", "Needs review", "Event date passed". */
  status: string;
  /** One plain-text sentence explaining the decision. */
  reason: string;
  /** The article that justifies the decision (usually the article itself), or null. */
  source: string | null;
  /** UTC instant after which the article is archived, when one is known. */
  until: string | null;
}

/** The part of an `Article` that `assessArticle` reads. */
export type RelevanceArticle = Pick<
  Article,
  "id" | "type" | "title" | "body" | "contentHash" | "url"
> &
  Partial<Pick<Article, "change">>;

/** Anything shaped like `NewsRules` — an empty object means "no rules". */
export interface RelevanceRules {
  articles?: Readonly<Record<string, NewsRule>>;
}

const decision = (
  bucket: RelevanceBucket,
  status: string,
  reason: string,
  source: string | null = null,
  until: string | null = null,
): RelevanceDecision => ({ bucket, status, reason, source, until });

/**
 * @param articles every known article (rules may depend on other articles' hashes)
 * @param now ISO instant to judge against (defaults to the current time)
 */
export function assessArticle(
  article: RelevanceArticle,
  articles: readonly RelevanceArticle[],
  rules: RelevanceRules,
  now: string = new Date().toISOString(),
): RelevanceDecision {
  const instant = Date.parse(now);
  if (!Number.isFinite(instant)) throw new Error("Invalid relevance assessment time.");
  const byId = new Map(articles.map((a) => [a.id, a]));

  if (article.change === "Not listed")
    return decision(
      "current",
      "Needs review",
      "No longer in Nexon feeds. Retained until relevance can be verified.",
      article.url,
    );
  if (article.type === "Maintenance" && /^\[Completed\]/i.test(article.title))
    return decision("archive", "Completed", "Nexon marks this maintenance completed.", article.url);

  const rule = rules.articles?.[String(article.id)];
  if (rule) {
    if (
      article.contentHash !== rule.contentHash ||
      rule.evidence.some((e) => byId.get(e.id)?.contentHash !== e.contentHash)
    )
      return decision(
        "current",
        "Needs review",
        "Source changed since the relevance rule was checked. Kept current for review.",
        article.url,
      );
    switch (rule.kind) {
      case "keep":
        return decision("current", "Ongoing reference", rule.reason, article.url);
      case "review":
        return decision("current", "Needs review", rule.reason, article.url);
      case "calendar": {
        const date = new Intl.DateTimeFormat("en-CA", {
          timeZone: rule.calendarZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(now));
        const passed = date > rule.eventDate;
        return decision(
          passed ? "archive" : "current",
          passed ? "Event date passed" : "Current / upcoming",
          rule.reason,
          rule.source || article.url,
        );
      }
      case "historical":
        return decision(
          "archive",
          rule.status || "Past / superseded",
          rule.reason,
          rule.source || article.url,
          null,
        );
      case "expire": {
        const until = rule.until;
        if (instant > Date.parse(until))
          return decision(
            "archive",
            rule.status || "Past / superseded",
            rule.reason,
            rule.source || article.url,
            until,
          );
        return decision(
          "current",
          "Current / upcoming",
          rule.currentReason || "The relevant period has not ended.",
          rule.source || article.url,
          until,
        );
      }
    }
  }

  // Only an explicit whole-event duration at the start of a post can expire a new article
  // automatically. Incidental past dates never archive an evergreen notice.
  const lines = article.body.split("\n");
  const durationIndex = lines.findIndex((line) =>
    /^\s*(?:Event|Sale|Test) (?:Duration|Period)\s*:?\s*$/i.test(line),
  );
  if (
    (article.type === "Event / sign-up" || article.type === "Sale") &&
    durationIndex >= 0 &&
    durationIndex < 12
  ) {
    const line = lines[durationIndex + 1] || "";
    const times = parseExplicitTimes(line);
    const [first, second] = times;
    if (times.length === 2 && first?.utc && second?.utc && /\s[-–—]\s|\s+to\s+/i.test(line)) {
      const start = Date.parse(first.utc);
      const end = Date.parse(second.utc);
      const futureDates = parseExplicitTimes(article.body).some(
        (t) => t.utc && Date.parse(t.utc) > end,
      );
      if (start < end && !futureDates)
        return decision(
          instant > end ? "archive" : "current",
          instant > end ? "Ended" : "Current / upcoming",
          "Explicit whole-event period in the official article.",
          article.url,
          second.utc,
        );
    }
  }
  return decision(
    "current",
    "Needs review",
    "No verified whole-article expiry. Kept current to avoid hiding relevant information.",
    article.url,
  );
}

export type AssessedArticle<T extends RelevanceArticle> = T & { relevance: RelevanceDecision };

/** `assessArticle` for every article (Astra `annotateSnapshot`), judged at one instant. */
export function annotateArticles<T extends RelevanceArticle>(
  articles: readonly T[],
  rules: RelevanceRules,
  now: string = new Date().toISOString(),
): AssessedArticle<T>[] {
  return articles.map((a) => ({ ...a, relevance: assessArticle(a, articles, rules, now) }));
}
