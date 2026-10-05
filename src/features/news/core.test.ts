import fixture44134 from "../../../tests/fixtures/news/44134.json";
import fixture45385 from "../../../tests/fixtures/news/45385.json";
import fixture45621 from "../../../tests/fixtures/news/45621.json";
import {
  API,
  CLASSIC,
  classify,
  dateReferences,
  hash,
  matchReason,
  normalize,
  plainText,
  validateItem,
  type NexonItem,
} from "./core";
import { ArticleSchema } from "./schema";

// Ported from Astra app/test.mjs (the pure-function cases). Fixtures are raw cache files copied
// from Astra's data/cache on 5 Oct 2026: { data, etag, lastModified, checkedAt }.

const item = (id: number, extra: Partial<NexonItem> = {}): NexonItem => ({
  id,
  name: "A MapleStory update",
  category: "general",
  liveDate: "2026-09-20T10:00:00Z",
  summary: "An official notice.",
  body: "<p>A general announcement.</p>",
  isMSCW: false,
  ...extra,
});

test("API is the public Nexon CMS feed", () => {
  expect(API).toBe("https://g.nexonstatic.com/maplestory/cms/v1");
});

test("classification distinguishes Classic World from ordinary classic content", () => {
  expect(matchReason(item(1, { body: "Classic hairstyles and old worlds." }))).toBeNull();
  expect(matchReason(item(1, { isMSCW: true }))).toBe("Nexon Classic tag");
  expect(matchReason(item(1, { name: "Global MapleStory Classic World FAQ" }))).toBe(
    "Classic named in title / summary",
  );
  expect(matchReason(item(1, { body: "News about Classic World." }))).toBe(
    "Classic mentioned in article",
  );
  expect(matchReason(item(1, { summary: "MSCW launch" }))).toBe("Classic named in title / summary");
  expect(matchReason({ name: "No summary or body at all" })).toBeNull();
});

test("CLASSIC matches the official spellings only", () => {
  for (const ok of ["MapleStory Classic World", "Maple Story Classic", "classic world", "MSCW"])
    expect(CLASSIC.test(ok)).toBe(true);
  for (const no of ["Classic hairstyles", "a classical world", "MSCWX"])
    expect(CLASSIC.test(no)).toBe(false);
});

test("visible text strips executable elements and preserves dates", () => {
  expect(
    plainText("<script>Classic World</script><p>A &amp; B&#8217;s</p><p>October 6, 2026</p>"),
  ).toBe("A & B’s\nOctober 6, 2026");
  expect(matchReason(item(1, { body: "<script>Classic World</script>Other news" }))).toBeNull();
});

test("plainText: tables, lists, hex entities, bad code points, unknown entities", () => {
  expect(plainText("<table><tr><td>A</td><td>B</td></tr></table>")).toBe("A / B /");
  expect(plainText("<ul><li>one</li><li>two</li></ul>")).toBe("one\ntwo");
  expect(plainText("x<br>y<hr/>z")).toBe("x\ny\nz");
  expect(plainText("&#x41;&#66;&#0;&#xD800;&#x110000;")).toBe("AB");
  expect(plainText("&bogus; &AMP;")).toBe("&bogus; &");
  expect(plainText("<style>p{}</style>  a \t b  ")).toBe("a b");
  expect(plainText(undefined)).toBe("");
});

test("plainText does not resolve prototype members as entities", () => {
  expect(plainText("&constructor; &__proto__; &toString; &hasOwnProperty;")).toBe(
    "&constructor; &__proto__; &toString; &hasOwnProperty;",
  );
});

test("metadata validation rejects missing and malformed fields", () => {
  expect(() => validateItem(item(1, { liveDate: "yesterday" }))).toThrow(/timestamp/);
  expect(() => validateItem(item(1, { isMSCW: "true" as unknown as boolean }))).toThrow(/tag/);
  expect(() => validateItem(item(1, { body: "" }), true)).toThrow(/empty/);
  expect(() => validateItem(item(1, { category: "../admin" }))).toThrow(/category/);
  expect(() => validateItem(item(1, { name: "  " }))).toThrow(/missing name/);
  expect(() => validateItem(item(0))).toThrow(/Invalid article ID/);
  expect(() => validateItem(item(1.5))).toThrow(/Invalid article ID/);
  expect(() => validateItem(null)).toThrow(/Invalid article ID/);
  expect(() => validateItem("nope")).toThrow(/Invalid article ID/);
  expect(() => validateItem({ ...item(1), id: "1" })).toThrow(/Invalid article ID/);
});

test("metadata validation accepts good items, including a null Classic tag", () => {
  const good = item(7, { isMSCW: null });
  expect(validateItem(good)).toBe(good);
  expect(validateItem(item(8, { liveDate: "2026-10-03T13:30:00+09:00" }))).toBeTruthy();
  expect(validateItem(item(9), true).id).toBe(9);
});

test("derived type can identify release notes under general category", () => {
  expect(classify(item(1, { name: "Founder's Access Release Notes" }))).toBe("Update");
  expect(classify(item(1, { name: "Classic World Known Issues", category: "maintenance" }))).toBe(
    "Known issues",
  );
});

test("classify covers the remaining types", () => {
  expect(classify({ name: "Anything", category: "update" })).toBe("Update");
  expect(classify({ name: "[Completed] Scheduled Maintenance" })).toBe("Maintenance");
  expect(classify({ name: "Anything", category: "maintenance" })).toBe("Maintenance");
  expect(classify({ name: "Founder's Packages Now On Sale!", category: "sale" })).toBe("Sale");
  expect(classify({ name: "Packages are on sale" })).toBe("Sale");
  expect(classify({ name: "Sign Up for the test" })).toBe("Event / sign-up");
  expect(classify({ name: "PC Cafe Event", category: "general" })).toBe("Event / sign-up");
  expect(classify({ name: "Anything", category: "events" })).toBe("Event / sign-up");
  expect(classify({ name: "Founder's Package Purchase Guide" })).toBe("Guide / FAQ");
  expect(classify({ name: "Maple Memo: A letter" })).toBe("Notice");
});

describe("hash", () => {
  test("is SHA-256 hex of a string", async () => {
    expect(await hash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await hash("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  test("hashes non-strings as their JSON text", async () => {
    expect(await hash({ a: 1, b: ["x"] })).toBe(await hash('{"a":1,"b":["x"]}'));
    expect(await hash([1, 2])).toBe(await hash("[1,2]"));
  });
  test("is UTF-8 over the whole string, including astral characters", async () => {
    // Reference computed with Node crypto: sha256("é𝄞’") over UTF-8.
    expect(await hash("é𝄞’")).toBe(
      "a417ac4271da378e9a295640b5696a467756d00a673cf3c332b3af94f16ab720",
    );
    expect(await hash("é")).not.toBe(await hash("e"));
  });
  test("rejects values JSON cannot serialise", async () => {
    await expect(hash(undefined)).rejects.toThrow(TypeError);
  });
});

test("content edits are detected even if listing metadata is unchanged", async () => {
  const source = item(1, { isMSCW: true });
  const a = await normalize(source, source, "2026-10-01T00:00:00Z");
  expect(a?.change).toBe("New");
  const b = await normalize(source, source, "2026-10-02T00:00:00Z", a);
  expect(b?.change).toBe("Unchanged");
  expect(b?.lastChanged).toBe(a?.lastChanged);
  const c = await normalize(
    { ...source, body: "<p>Changed deadline: October 8, 2026.</p>" },
    source,
    "2026-10-03T00:00:00Z",
    b,
  );
  expect(c?.change).toBe("Updated");
  expect(c?.firstSeen).toBe(a?.firstSeen);
  expect(c?.lastChanged).toBe("2026-10-03T00:00:00Z");
});

test("normalize returns null for articles that are not Classic World news", async () => {
  const plain = item(2);
  expect(await normalize(plain, plain, "2026-10-01T00:00:00Z")).toBeNull();
});

test("normalize builds a plain-text article with a nexon.com url and a schema-valid shape", async () => {
  const source = item(3, {
    isMSCW: true,
    category: "General",
    name: "<b>Bold</b> &amp; news",
    body: "<p>Hi</p>",
  });
  const a = await normalize(source, { ...source, feed: "archived" }, "2026-10-01T00:00:00Z");
  expect(a).toMatchObject({
    id: 3,
    title: "Bold & news",
    body: "Hi",
    url: "https://www.nexon.com/maplestory/news/general/3",
    tagged: true,
    reason: "Nexon Classic tag",
    feed: "archived",
    availability: "Verified",
  });
  expect(ArticleSchema.safeParse(a).success).toBe(true);
});

test("normalize takes the summary from the index entry when the article has none", async () => {
  const detail = item(4, { isMSCW: true, summary: undefined });
  const feed = item(4, { isMSCW: true, summary: "From the index" });
  expect((await normalize(detail, feed, "2026-10-01T00:00:00Z"))?.summary).toBe("From the index");
});

test("date excerpts retain source time zones and never infer event intervals", () => {
  const a = {
    id: 1,
    title: "Test",
    publishedUTC: "2026-10-01T00:00:00Z",
    checkedAt: "2026-10-01T00:00:00Z",
    body: "Registration\nOctober 6, 2026 at 11:00 AM PDT / October 7, 4:00 AM AEST\nOther line",
    url: "https://www.nexon.com/maplestory/news/general/1",
  };
  const refs = dateReferences(a);
  expect(refs).toHaveLength(1);
  expect(refs[0]?.excerpt).toMatch(/AEST/);
  expect(refs[0]?.context).toBe("Registration");
  expect(refs[0]).not.toHaveProperty("start");
});

test("date excerpts de-duplicate identical lines", () => {
  const a = {
    id: 1,
    title: "T",
    publishedUTC: "x",
    checkedAt: "x",
    body: "Heading\nOctober 6, 2026\nOther\nOctober 6, 2026",
    url: "u",
  };
  expect(dateReferences(a)).toHaveLength(1);
});

// ---------------------------------------------------------------------------------------------
// Real articles: the contentHash values Astra stored on 5 Oct 2026 (data/current.json).
// The pinned hashes in datapack/news-rules.json and the seed events depend on these.
// ---------------------------------------------------------------------------------------------

describe("raw Nexon articles (tests/fixtures/news)", () => {
  const cases = [
    {
      name: "45621 Founder's Access Release Notes",
      fixture: fixture45621,
      hash: "5e82b958d6881667735ed020810de1bb2fda23d351fb2db679457e762355d25f",
      type: "Update",
    },
    {
      name: "45385 MapleStory Classic World FAQ",
      fixture: fixture45385,
      hash: "833d454d6c33ecc420f75e4bac4c6baebdb01934fd5883e2498549d4b6748e40",
      type: "Guide / FAQ",
    },
    {
      name: "44134 Classic World Founder's Packages Now On Sale!",
      fixture: fixture44134,
      hash: "2282f166abf2cc7fac085800c2727109f7b273a8dd0dce4033354c7bea5ce5d1",
      type: "Sale",
    },
  ] as const;

  test.each(cases)(
    "$name normalizes to the stored contentHash",
    async ({ fixture, hash: expected, type }) => {
      const detail = validateItem(fixture.data, true);
      const article = await normalize(detail, detail, "2026-10-05T00:00:00Z");
      expect(article?.contentHash).toBe(expected);
      expect(article?.type).toBe(type);
      expect(article?.tagged).toBe(true);
      expect(article?.body.length).toBeGreaterThan(100);
      expect(article?.body).not.toMatch(/<\/?(?:p|div|script|li)\b/i);
      expect(ArticleSchema.safeParse(article).success).toBe(true);
    },
  );

  test("45621 yields the hash recorded for it by Astra", async () => {
    const detail = validateItem(fixture45621.data, true);
    const article = await normalize(detail, detail, "2026-10-05T00:00:00Z");
    expect(article?.contentHash).toBe(
      "5e82b958d6881667735ed020810de1bb2fda23d351fb2db679457e762355d25f",
    );
    expect(article?.url).toBe("https://www.nexon.com/maplestory/news/general/45621");
    expect(article?.publishedUTC).toBe("2026-10-03T13:30:00Z");
  });

  test("45621 date excerpts include the launch time with its stated zone", async () => {
    const detail = validateItem(fixture45621.data, true);
    const article = await normalize(detail, detail, "2026-10-05T00:00:00Z");
    expect(article).not.toBeNull();
    if (!article) return;
    const refs = dateReferences(article);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r) => /October 6, 2026 6:00 PM UTC/.test(r.excerpt))).toBe(true);
  });
});
