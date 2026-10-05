import shippedRules from "../../../datapack/news-rules.json";
import fixture44134 from "../../../tests/fixtures/news/44134.json";
import fixture45385 from "../../../tests/fixtures/news/45385.json";
import fixture45621 from "../../../tests/fixtures/news/45621.json";
import { normalize, validateItem } from "./core";
import { annotateArticles, assessArticle, type RelevanceArticle } from "./relevance";
import { NewsRulesSchema, type Article } from "./schema";

// Ported from Astra app/timing.test.mjs (the relevance cases) and extended for the shipped rules.

const H = (c: string) => c.repeat(64);

const art = (extra: Partial<RelevanceArticle> = {}): RelevanceArticle => ({
  id: 1,
  type: "Notice",
  title: "Policy",
  body: "",
  url: "https://example.test",
  contentHash: H("a"),
  ...extra,
});

/** Parses through the real schema so tests also exercise defaults (`evidence: []`). */
const rulesOf = (articles: Record<string, unknown>) =>
  NewsRulesSchema.parse({ version: 1, reviewedAt: "2026-10-03T00:00:00.000Z", articles });

test("unknown old notices remain visible and completed maintenance is archived", () => {
  const a = art({ body: "A policy dated January 1, 2020." });
  expect(assessArticle(a, [a], {}, "2026-10-04T00:00:00Z").bucket).toBe("current");
  const m = art({ type: "Maintenance", title: "[Completed] Maintenance" });
  expect(assessArticle(m, [a], {}).bucket).toBe("archive");
  expect(assessArticle(m, [a], {}).status).toBe("Completed");
});

test("a source revision or dependency revision invalidates an archive rule", () => {
  const a = art({ type: "Notice", title: "Event", contentHash: H("b") });
  const stale = rulesOf({ 1: { contentHash: H("a"), kind: "historical", reason: "Old" } });
  expect(assessArticle(a, [a], stale).status).toBe("Needs review");
  expect(assessArticle(a, [a], stale).bucket).toBe("current");

  const withEvidence = rulesOf({
    1: {
      contentHash: H("b"),
      kind: "historical",
      reason: "Old",
      evidence: [{ id: 2, contentHash: H("c") }],
    },
  });
  // The evidence article is missing...
  expect(assessArticle(a, [a], withEvidence).status).toBe("Needs review");
  // ...or has a different hash...
  const other = art({ id: 2, contentHash: H("d") });
  expect(assessArticle(a, [a, other], withEvidence).status).toBe("Needs review");
  // ...but with the pinned hash the rule applies.
  const pinned = art({ id: 2, contentHash: H("c") });
  expect(assessArticle(a, [a, pinned], withEvidence)).toMatchObject({
    bucket: "archive",
    status: "Past / superseded",
  });
});

test("verified deadline switches only after its UTC instant", () => {
  const a = art({ type: "Event / sign-up", title: "Event" });
  const rules = rulesOf({
    1: { contentHash: H("a"), kind: "expire", until: "2026-10-06T18:00:00Z", reason: "Ended" },
  });
  expect(assessArticle(a, [a], rules, "2026-10-06T17:59:59Z").bucket).toBe("current");
  expect(assessArticle(a, [a], rules, "2026-10-06T18:00:00Z").bucket).toBe("current"); // not strictly after
  const after = assessArticle(a, [a], rules, "2026-10-06T18:00:01Z");
  expect(after).toMatchObject({
    bucket: "archive",
    status: "Past / superseded",
    reason: "Ended",
    until: "2026-10-06T18:00:00Z",
  });
});

test("new events expire only when the whole-event duration is complete and unambiguous", () => {
  const a = art({
    type: "Event / sign-up",
    title: "New event",
    body: "Event Duration:\nOctober 6, 2026 6:00 PM UTC - October 20, 2026 11:59 PM UTC",
  });
  expect(assessArticle(a, [a], {}, "2026-10-20T00:00:00Z").bucket).toBe("current");
  expect(assessArticle(a, [a], {}, "2026-10-21T00:00:00Z").bucket).toBe("archive");
  expect(assessArticle(a, [a], {}, "2026-10-21T00:00:00Z")).toMatchObject({
    status: "Ended",
    until: "2026-10-20T23:59:00.000Z",
  });
  const later = art({
    ...a,
    body: a.body + "\nClaim your prize by November 30, 2026 11:59 PM UTC.",
  });
  expect(assessArticle(later, [later], {}, "2026-10-21T00:00:00Z").status).toBe("Needs review");
  const incomplete = art({ ...a, body: a.body.replaceAll(", 2026", "") });
  expect(assessArticle(incomplete, [incomplete], {}, "2026-10-21T00:00:00Z").status).toBe(
    "Needs review",
  );
});

test("a duration heading on a notice (not an event or sale) never expires it", () => {
  const n = art({
    type: "Notice",
    body: "Event Duration:\nOctober 6, 2026 6:00 PM UTC - October 20, 2026 11:59 PM UTC",
  });
  expect(assessArticle(n, [n], {}, "2027-01-01T00:00:00Z").bucket).toBe("current");
});

test("a retained article that Nexon no longer lists stays current, flagged for review", () => {
  const a = art({ change: "Not listed" });
  expect(assessArticle(a, [a], {}, "2030-01-01T00:00:00Z")).toMatchObject({
    bucket: "current",
    status: "Needs review",
  });
});

test("an invalid assessment time throws", () => {
  const a = art();
  expect(() => assessArticle(a, [a], {}, "nope")).toThrow(/Invalid relevance assessment time/);
});

test("keep and review rules stay current; a calendar rule follows the zone's own calendar day", () => {
  const a = art({ id: 5 });
  const keep = rulesOf({ 5: { contentHash: H("a"), kind: "keep", reason: "Reference." } });
  expect(assessArticle(a, [a], keep, "2040-01-01T00:00:00Z")).toMatchObject({
    bucket: "current",
    status: "Ongoing reference",
    reason: "Reference.",
  });
  const review = rulesOf({ 5: { contentHash: H("a"), kind: "review", reason: "Unclear." } });
  expect(assessArticle(a, [a], review, "2040-01-01T00:00:00Z")).toMatchObject({
    bucket: "current",
    status: "Needs review",
  });
  const calendar = rulesOf({
    5: {
      contentHash: H("a"),
      kind: "calendar",
      eventDate: "2026-10-17",
      calendarZone: "America/Los_Angeles",
      reason: "LA day.",
    },
  });
  // 17 Oct 20:00 UTC is already 18 Oct in Sydney but still 17 Oct (1 pm) in Los Angeles.
  expect(assessArticle(a, [a], calendar, "2026-10-17T20:00:00Z")).toMatchObject({
    bucket: "current",
    status: "Current / upcoming",
  });
  expect(assessArticle(a, [a], calendar, "2026-10-18T06:59:59Z").bucket).toBe("current");
  expect(assessArticle(a, [a], calendar, "2026-10-18T07:00:00Z")).toMatchObject({
    bucket: "archive",
    status: "Event date passed",
  });
});

test("annotateArticles judges every article at one instant", () => {
  const a = art({ id: 1 });
  const m = art({ id: 2, type: "Maintenance", title: "[Completed] x" });
  const out = annotateArticles([a, m], {}, "2026-10-04T00:00:00Z");
  expect(out.map((x) => x.relevance.bucket)).toEqual(["current", "archive"]);
  expect(out[0]?.id).toBe(1);
});

// ---------------------------------------------------------------------------------------------
// The shipped rules (datapack/news-rules.json) against real articles
// ---------------------------------------------------------------------------------------------

describe("datapack/news-rules.json", () => {
  const rules = NewsRulesSchema.parse(shippedRules);

  test("parses with the schema and covers the 28 articles Astra reviewed", () => {
    expect(rules.version).toBe(1);
    expect(Object.keys(rules.articles)).toHaveLength(28);
    for (const [id, rule] of Object.entries(rules.articles)) {
      expect(rule.contentHash).toMatch(/^[0-9a-f]{64}$/);
      for (const e of rule.evidence) expect(e.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(Number(id)).toBeGreaterThan(0);
    }
  });

  test("the schema rejects malformed rules", () => {
    const bad = (articles: Record<string, unknown>) =>
      NewsRulesSchema.safeParse({ version: 1, reviewedAt: "2026-10-03T00:00:00.000Z", articles })
        .success;
    expect(bad({ 1: { contentHash: "short", kind: "keep", reason: "x" } })).toBe(false);
    expect(bad({ 1: { contentHash: H("a"), kind: "mystery", reason: "x" } })).toBe(false);
    expect(bad({ 1: { contentHash: H("a"), kind: "expire", reason: "x" } })).toBe(false); // needs `until`
    expect(
      bad({ 1: { contentHash: H("a"), kind: "expire", until: "tomorrow", reason: "x" } }),
    ).toBe(false);
    expect(
      bad({
        1: {
          contentHash: H("a"),
          kind: "calendar",
          eventDate: "2026-10-17",
          calendarZone: "Nowhere/Land",
          reason: "x",
        },
      }),
    ).toBe(false);
    expect(bad({ x: { contentHash: H("a"), kind: "keep", reason: "x" } })).toBe(false);
    expect(bad({ 1: { contentHash: H("a"), kind: "keep", reason: "x" } })).toBe(true);
  });

  const articleFrom = async (fixture: { data: unknown }): Promise<Article> => {
    const detail = validateItem(fixture.data, true);
    const article = await normalize(detail, detail, "2026-10-05T00:00:00Z");
    if (!article) throw new Error("fixture is not Classic World news");
    return article;
  };

  test("the pinned hashes match the real fixtures' normalized hashes", async () => {
    const [a45621, a45385, a44134] = await Promise.all([
      articleFrom(fixture45621),
      articleFrom(fixture45385),
      articleFrom(fixture44134),
    ]);
    expect(rules.articles["45621"]?.contentHash).toBe(a45621.contentHash);
    expect(rules.articles["45385"]?.contentHash).toBe(a45385.contentHash);
    expect(rules.articles["44134"]?.contentHash).toBe(a44134.contentHash);
    expect(rules.articles["44134"]?.evidence).toEqual([
      { id: 45385, contentHash: a45385.contentHash },
    ]);
  });

  test("45621 and 45385 are ongoing references; 44134 is current until the claim deadline", async () => {
    const all = await Promise.all([
      articleFrom(fixture45621),
      articleFrom(fixture45385),
      articleFrom(fixture44134),
    ]);
    const get = (id: number) => {
      const found = all.find((a) => a.id === id);
      if (!found) throw new Error("missing fixture");
      return found;
    };
    for (const now of ["2026-10-05T00:00:00Z", "2030-01-01T00:00:00Z"]) {
      expect(assessArticle(get(45621), all, rules, now)).toMatchObject({
        bucket: "current",
        status: "Ongoing reference",
      });
      expect(assessArticle(get(45385), all, rules, now)).toMatchObject({
        bucket: "current",
        status: "Ongoing reference",
      });
    }
    expect(assessArticle(get(44134), all, rules, "2026-11-30T23:58:59Z")).toMatchObject({
      bucket: "current",
      status: "Current / upcoming",
      until: "2026-11-30T23:59:00.000Z",
      source: "https://www.nexon.com/maplestory/news/general/45385",
    });
    expect(assessArticle(get(44134), all, rules, "2026-11-30T23:59:01Z")).toMatchObject({
      bucket: "archive",
      status: "Sale and claim period ended",
    });
  });

  test("an edited article falls back to Needs review instead of using the old rule", async () => {
    const all = await Promise.all([
      articleFrom(fixture45621),
      articleFrom(fixture45385),
      articleFrom(fixture44134),
    ]);
    const edited = all.map((a) => (a.id === 45621 ? { ...a, contentHash: H("e") } : a));
    expect(
      assessArticle(edited[0] as Article, edited, rules, "2030-01-01T00:00:00Z"),
    ).toMatchObject({
      bucket: "current",
      status: "Needs review",
    });
    // 44134 depends on 45385 as evidence: editing 45385 invalidates 44134's rule too.
    const editedFaq = all.map((a) => (a.id === 45385 ? { ...a, contentHash: H("f") } : a));
    expect(
      assessArticle(editedFaq[2] as Article, editedFaq, rules, "2030-01-01T00:00:00Z").status,
    ).toBe("Needs review");
    // ...and so does the evidence article being absent from the list.
    expect(
      assessArticle(all[2] as Article, [all[2] as Article], rules, "2030-01-01T00:00:00Z").status,
    ).toBe("Needs review");
  });

  test("the Maple Fest 2026 rule (calendar day in Los Angeles)", () => {
    const rule = rules.articles["42772"];
    expect(rule?.kind).toBe("calendar");
    const a = art({ id: 42772, contentHash: rule?.contentHash ?? "" });
    expect(assessArticle(a, [a], rules, "2026-10-04T00:00:00Z").bucket).toBe("current");
    expect(assessArticle(a, [a], rules, "2026-10-18T08:00:00Z").bucket).toBe("archive");
  });

  test("closed-test articles are archived after 24 April 2026 and uncertain ones stay for review", () => {
    for (const id of [35337, 39217, 39378, 40017, 40325]) {
      const rule = rules.articles[String(id)];
      const a = art({ id, type: "Notice", contentHash: rule?.contentHash ?? "" });
      const evidence = (rule?.evidence ?? []).map((e) =>
        art({ id: e.id, contentHash: e.contentHash }),
      );
      expect(assessArticle(a, [a, ...evidence], rules, "2026-04-23T00:00:00Z").bucket).toBe(
        "current",
      );
      expect(assessArticle(a, [a, ...evidence], rules, "2026-10-05T00:00:00Z").bucket).toBe(
        "archive",
      );
    }
    for (const id of [36686, 41040, 44359]) {
      const a = art({ id, contentHash: rules.articles[String(id)]?.contentHash ?? "" });
      expect(assessArticle(a, [a], rules, "2026-10-05T00:00:00Z")).toMatchObject({
        bucket: "current",
        status: "Needs review",
      });
    }
  });
});
