import fixture45621 from "../../../tests/fixtures/news/45621.json";
import {
  ARCHIVE_INTERVAL_MS,
  MAX_ATTEMPTS,
  NEWS_CACHE_KEYS,
  PACE_MS,
  loadCachedNews,
  refreshNews,
  userAgent,
  type FetchInit,
  type FetchResponse,
  type Fetcher,
  type NewsCache,
  type NewsClientDeps,
} from "./client";
import { API, type NexonItem } from "./core";
import { ArticleSchema } from "./schema";

// P7-T2 — the news client against a mocked Nexon (injected Fetcher / NewsCache, virtual clock).

const START = Date.parse("2026-10-05T00:00:00Z");
const KEY_RX = /^[a-z0-9-]{1,64}$/;

// ---- Fake Nexon ----------------------------------------------------------------------------------

const item = (id: number, extra: Partial<NexonItem> = {}): NexonItem => ({
  id,
  name: `Plain notice ${id}`,
  category: "general",
  liveDate: new Date(START - id * 3_600_000).toISOString(),
  summary: "An official notice.",
  isMSCW: false,
  ...extra,
});
const tagged = (id: number, extra: Partial<NexonItem> = {}) =>
  item(id, { name: `Classic World notice ${id}`, isMSCW: true, ...extra });

const reply = (status: number, body = "", headers: Record<string, string> = {}): FetchResponse => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => body,
});

interface Logged {
  path: string;
  headers: Record<string, string>;
  at: number;
  init: FetchInit;
}

function makeWorld() {
  const clock = {
    t: START,
    sleeps: [] as number[],
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.sleeps.push(ms);
      clock.t += ms;
    },
  };

  const news: NexonItem[] = [];
  const archived: NexonItem[] = [];
  /** Full articles served by `/news/{id}`; defaults to the index item plus a body. */
  const details = new Map<number, NexonItem>();
  const revision = new Map<string, number>();
  const log: Logged[] = [];
  /** Canned responses consumed first-in-first-out per path, before normal service. */
  const canned = new Map<string, Array<() => Promise<FetchResponse>>>();

  const bump = (path: string) => revision.set(path, (revision.get(path) ?? 1) + 1);
  const detailOf = (id: number): NexonItem | undefined => {
    const found = details.get(id);
    if (found) return found;
    const base = [...news, ...archived].find((x) => x.id === id);
    return base && { ...base, body: `<p>Body of ${base.name}. October 6, 2026 6:00 PM UTC</p>` };
  };

  const fetcher: Fetcher = async (url, init) => {
    expect(url.startsWith(API + "/")).toBe(true);
    const path = url.slice(API.length);
    log.push({ path, headers: init.headers, at: clock.now(), init });
    const next = canned.get(path)?.shift();
    if (next) return next();
    let body: unknown;
    if (path === "/news") body = news;
    else if (path === "/archived") body = archived;
    else if (/^\/news\/\d+$/.test(path)) body = detailOf(Number(path.slice(6)));
    if (body === undefined) return reply(404, "{}");
    const etag = `W/"${path}:${revision.get(path) ?? 1}"`;
    if (init.headers["If-None-Match"] === etag) return reply(304, "", { etag });
    return reply(200, JSON.stringify(body), {
      etag,
      "last-modified": "Mon, 05 Oct 2026 00:00:00 GMT",
    });
  };

  return {
    clock,
    news,
    archived,
    details,
    log,
    fetcher,
    bump,
    fail: (path: string, ...responses: Array<() => Promise<FetchResponse>>) =>
      canned.set(path, [...(canned.get(path) ?? []), ...responses]),
    paths: () => log.map((l) => l.path),
    count: (path: string) => log.filter((l) => l.path === path).length,
    resetLog: () => {
      log.length = 0;
    },
  };
}
type World = ReturnType<typeof makeWorld>;

function makeCache() {
  const files = new Map<string, string>();
  const writes: string[] = [];
  let failWrites = false;
  const cache: NewsCache = {
    read: async (key) => {
      expect(key).toMatch(KEY_RX);
      return files.get(key) ?? null;
    },
    write: async (key, json) => {
      expect(key).toMatch(KEY_RX);
      expect(() => JSON.parse(json)).not.toThrow();
      if (failWrites) throw new Error("disk full");
      files.set(key, json);
      writes.push(key);
    },
  };
  return {
    cache,
    files,
    writes,
    failWrites: (on: boolean) => {
      failWrites = on;
    },
  };
}
type Cache = ReturnType<typeof makeCache>;

const deps = (world: World, c: Cache, extra: Partial<NewsClientDeps> = {}): NewsClientDeps => ({
  fetcher: world.fetcher,
  cache: c.cache,
  appVersion: "1.2.3",
  now: world.clock.now,
  sleep: world.clock.sleep,
  ...extra,
});

/** 20 live items (ids 1-3 tagged) and a 40-item archive (ids 101-102 tagged, 103 body-only). */
function seed(world: World) {
  world.news.push(tagged(1), tagged(2), tagged(3));
  for (let id = 4; id <= 20; id++) world.news.push(item(id));
  world.archived.push(tagged(101), tagged(102, { name: "Archived tagged notice" }));
  for (let id = 103; id <= 140; id++) world.archived.push(item(id));
}

// ---- Tests ---------------------------------------------------------------------------------------

describe("first run (200)", () => {
  test("fetches the indexes, then only the matching articles", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    const result = await refreshNews(deps(world, c));

    expect(result.problems).toEqual([]);
    expect(result.fromCache).toBe(false);
    expect(result.fetchedAt).toBe(new Date(world.clock.now()).toISOString());
    expect(result.articles.map((a) => a.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 101, 102]);

    const paths = world.paths();
    expect(paths.slice(0, 2)).toEqual(["/news", "/archived"]);
    expect(paths.slice(2).sort()).toEqual([
      "/news/1",
      "/news/101",
      "/news/102",
      "/news/2",
      "/news/3",
    ]);
    // Nothing is requested for the 17 + 38 unrelated items.
    expect(paths).toHaveLength(7);
  });

  test("sends the polite headers and no validators on the first request", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    await refreshNews(deps(world, c));
    for (const l of world.log) {
      expect(l.headers["User-Agent"]).toBe("MapleClassicCompanion/1.2.3 (personal news reader)");
      expect(l.headers.Accept).toBe("application/json");
      expect(l.headers["If-None-Match"]).toBeUndefined();
      expect(l.init.redirect).toBe("error");
      expect(l.init.signal).toBeDefined();
    }
  });

  test("returns plain-text articles in the documented shape, newest first", async () => {
    const world = makeWorld();
    const c = makeCache();
    world.news.push(tagged(7, { name: "<b>Bold</b> &amp; Classic", category: "General" }));
    world.news.push(tagged(1));
    world.archived.push(item(200));
    world.details.set(7, {
      ...tagged(7, { name: "<b>Bold</b> &amp; Classic", category: "General" }),
      body: "<script>x</script><p>Hello &amp; welcome</p>",
    });
    const result = await refreshNews(deps(world, c));
    expect(result.articles.map((a) => a.id)).toEqual([1, 7]); // 1 is newer (smaller offset from START)
    const a7 = result.articles.find((a) => a.id === 7);
    expect(a7).toMatchObject({
      title: "Bold & Classic",
      body: "Hello & welcome",
      category: "General",
      type: "Notice",
      url: "https://www.nexon.com/maplestory/news/general/7",
      change: "New",
      feed: "news",
    });
    for (const a of result.articles) expect(ArticleSchema.safeParse(a).success).toBe(true);
  });

  test("the real 45621 article comes out with the pinned content hash", async () => {
    const world = makeWorld();
    const c = makeCache();
    const { body, ...indexEntry } = fixture45621.data;
    expect(body.length).toBeGreaterThan(1000);
    world.news.push(indexEntry as unknown as NexonItem);
    world.archived.push(item(200));
    world.details.set(45621, fixture45621.data as unknown as NexonItem);
    const result = await refreshNews(deps(world, c));
    expect(result.problems).toEqual([]);
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]).toMatchObject({
      id: 45621,
      type: "Update",
      contentHash: "5e82b958d6881667735ed020810de1bb2fda23d351fb2db679457e762355d25f",
    });
  });

  test("saves the snapshot, both indexes and each article under valid cache keys", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    await refreshNews(deps(world, c));
    expect([...c.files.keys()].sort()).toEqual(
      [
        NEWS_CACHE_KEYS.state,
        NEWS_CACHE_KEYS.newsIndex,
        NEWS_CACHE_KEYS.archiveIndex,
        ...[1, 2, 3, 101, 102].map(NEWS_CACHE_KEYS.article),
      ].sort(),
    );
    // Raw article cache files keep Astra's shape: { data, etag, lastModified, checkedAt }.
    const raw = JSON.parse(c.files.get("article-1") ?? "null") as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["checkedAt", "data", "etag", "lastModified"]);
    // The index cache holds only the matching items (not the 38 unrelated archive items).
    const archive = JSON.parse(c.files.get("index-archived") ?? "null") as {
      count: number;
      items: unknown[];
    };
    expect(archive.count).toBe(40);
    expect(archive.items).toHaveLength(2);
  });

  test("loadCachedNews returns what was saved, and nothing for an empty cache", async () => {
    const world = makeWorld();
    const c = makeCache();
    expect(await loadCachedNews(c.cache)).toEqual({
      articles: [],
      fetchedAt: null,
      fromCache: true,
      problems: [],
    });
    seed(world);
    const fresh = await refreshNews(deps(world, c));
    const saved = await loadCachedNews(c.cache);
    expect(saved.articles).toEqual(fresh.articles);
    expect(saved.fetchedAt).toBe(fresh.fetchedAt);
    expect(saved.fromCache).toBe(true);
  });
});

describe("pacing", () => {
  test("requests are at least 180 ms apart", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    await refreshNews(deps(world, c));
    const times = world.log.map((l) => l.at);
    expect(times.length).toBeGreaterThan(5);
    for (let i = 1; i < times.length; i++)
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(PACE_MS);
  });

  test("PACE_MS and MAX_ATTEMPTS are Astra's values", () => {
    expect(PACE_MS).toBe(180);
    expect(MAX_ATTEMPTS).toBe(3);
  });

  test("user agent", () => {
    expect(userAgent("0.1.0")).toBe("MapleClassicCompanion/0.1.0 (personal news reader)");
    expect(userAgent("1.0\r\nX-Evil: 1")).toBe(
      "MapleClassicCompanion/1.0X-Evil1 (personal news reader)",
    );
  });
});

describe("304 Not Modified", () => {
  test("a second refresh revalidates everything with ETags and skips the weekly archive", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    const first = await refreshNews(deps(world, c));
    world.resetLog();
    world.clock.t += 30 * 60_000; // the 30-minute re-check
    c.writes.length = 0;

    const second = await refreshNews(deps(world, c));
    expect(second.fromCache).toBe(false);
    expect(second.problems).toEqual([]);
    expect(world.count("/archived")).toBe(0);
    expect(world.paths().sort()).toEqual(
      ["/news", "/news/1", "/news/2", "/news/3", "/news/101", "/news/102"].sort(),
    );
    for (const l of world.log) expect(l.headers["If-None-Match"]).toMatch(/^W\//);
    for (const l of world.log)
      expect(l.headers["If-Modified-Since"]).toBe("Mon, 05 Oct 2026 00:00:00 GMT");

    expect(second.articles.map((a) => a.contentHash)).toEqual(
      first.articles.map((a) => a.contentHash),
    );
    expect(second.articles.every((a) => a.change === "Unchanged")).toBe(true);
    expect(second.articles.map((a) => a.firstSeen)).toEqual(first.articles.map((a) => a.firstSeen));
    expect(second.fetchedAt).not.toBe(first.fetchedAt);
    // A pure revalidation only rewrites the snapshot.
    expect(c.writes).toEqual([NEWS_CACHE_KEYS.state]);
  });

  test("the archive index is fetched again once a week, with its ETag", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    await refreshNews(deps(world, c));
    world.resetLog();
    world.clock.t += ARCHIVE_INTERVAL_MS - 60_000;
    await refreshNews(deps(world, c));
    expect(world.count("/archived")).toBe(0);
    world.clock.t += 120_000; // now > 7 days since the archive was checked
    world.resetLog();
    const result = await refreshNews(deps(world, c));
    expect(world.count("/archived")).toBe(1);
    expect(world.log.find((l) => l.path === "/archived")?.headers["If-None-Match"]).toBe(
      'W/"/archived:1"',
    );
    expect(result.problems).toEqual([]);
    expect(result.articles).toHaveLength(5);
  });

  test("forceArchive fetches the archive immediately", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    await refreshNews(deps(world, c));
    world.resetLog();
    await refreshNews(deps(world, c), { forceArchive: true });
    expect(world.count("/archived")).toBe(1);
  });

  test("a changed article is detected even though the index is unchanged", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    const first = await refreshNews(deps(world, c));
    world.clock.t += 30 * 60_000;
    world.details.set(2, { ...tagged(2), body: "<p>Changed deadline: October 8, 2026.</p>" });
    world.bump("/news/2");
    const second = await refreshNews(deps(world, c));
    const before = first.articles.find((a) => a.id === 2);
    const after = second.articles.find((a) => a.id === 2);
    expect(after?.change).toBe("Updated");
    expect(after?.contentHash).not.toBe(before?.contentHash);
    expect(after?.firstSeen).toBe(before?.firstSeen);
    expect(after?.lastChanged).toBe(after?.checkedAt);
    expect(before?.lastChanged).toBe(before?.checkedAt);
    expect(second.articles.find((a) => a.id === 1)?.change).toBe("Unchanged");
  });

  test("a new matching item appears on the next refresh and is fetched in full", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    await refreshNews(deps(world, c));
    world.news.unshift(tagged(21, { liveDate: new Date(START + 1000).toISOString() }));
    world.bump("/news");
    world.resetLog();
    world.clock.t += 30 * 60_000;
    const next = await refreshNews(deps(world, c));
    expect(next.articles[0]).toMatchObject({ id: 21, change: "New" });
    expect(world.log.find((l) => l.path === "/news")?.headers["If-None-Match"]).toBe('W/"/news:1"');
    expect(world.log.find((l) => l.path === "/news/21")?.headers["If-None-Match"]).toBeUndefined();
  });
});

describe("errors keep the last good data", () => {
  async function goodRun() {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    const first = await refreshNews(deps(world, c));
    world.resetLog();
    world.clock.sleeps.length = 0;
    world.clock.t += 30 * 60_000;
    return { world, c, first };
  }

  test("429 is retried with backoff and then succeeds", async () => {
    const { world, c, first } = await goodRun();
    world.fail(
      "/news",
      async () => reply(429),
      async () => reply(429),
    );
    const result = await refreshNews(deps(world, c));
    expect(result.fromCache).toBe(false);
    expect(result.problems).toEqual([]);
    expect(world.count("/news")).toBe(3);
    expect(world.clock.sleeps.filter((ms) => ms >= 1000)).toEqual([1000, 2000]);
    expect(result.articles).toHaveLength(first.articles.length);
  });

  test("429 on every attempt: the saved news is returned with a problem", async () => {
    const { world, c, first } = await goodRun();
    const before = c.files.get("news-state");
    world.fail(
      "/news",
      async () => reply(429),
      async () => reply(429),
      async () => reply(429),
    );
    const result = await refreshNews(deps(world, c));
    expect(world.count("/news")).toBe(MAX_ATTEMPTS);
    expect(result.fromCache).toBe(true);
    expect(result.fetchedAt).toBe(first.fetchedAt);
    expect(result.articles).toEqual(first.articles);
    expect(result.problems.join(" ")).toMatch(/HTTP 429/);
    expect(result.problems.join(" ")).toMatch(/Showing the saved news/);
    expect(world.count("/archived")).toBe(0);
    expect(c.files.get("news-state")).toBe(before);
  });

  test("500 on every attempt is retried then reported", async () => {
    const { world, c, first } = await goodRun();
    world.fail(
      "/news",
      async () => reply(500),
      async () => reply(503),
      async () => reply(500),
    );
    const result = await refreshNews(deps(world, c));
    expect(world.count("/news")).toBe(3);
    expect(result).toMatchObject({ fromCache: true, fetchedAt: first.fetchedAt });
    expect(result.problems.join(" ")).toMatch(/HTTP 500/);
  });

  test("a 404 is not retried", async () => {
    const { world, c } = await goodRun();
    world.fail("/news", async () => reply(404, "{}"));
    const result = await refreshNews(deps(world, c));
    expect(world.count("/news")).toBe(1);
    expect(result.fromCache).toBe(true);
    expect(result.problems.join(" ")).toMatch(/HTTP 404/);
  });

  test("a network error is retried (TypeError, plain string rejections)", async () => {
    const { world, c } = await goodRun();
    world.fail(
      "/news",
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => Promise.reject("connection reset"),
    );
    const result = await refreshNews(deps(world, c));
    expect(world.count("/news")).toBe(3);
    expect(result.fromCache).toBe(false);
  });

  test("HTML instead of JSON is reported without retrying, and the cache is untouched", async () => {
    const { world, c, first } = await goodRun();
    const filesBefore = new Map(c.files);
    world.fail("/news", async () =>
      reply(200, "<html><body>Maintenance</body></html>", { etag: 'W/"x"' }),
    );
    const result = await refreshNews(deps(world, c));
    expect(world.count("/news")).toBe(1);
    expect(result.fromCache).toBe(true);
    expect(result.articles).toEqual(first.articles);
    expect(result.problems.join(" ")).toMatch(/HTML or invalid JSON/);
    expect(new Map(c.files)).toEqual(filesBefore);
  });

  test("an index that is not a list is rejected", async () => {
    const { world, c } = await goodRun();
    world.fail("/news", async () => reply(200, JSON.stringify({ error: "nope" })));
    const result = await refreshNews(deps(world, c));
    expect(result.fromCache).toBe(true);
    expect(result.problems.join(" ")).toMatch(/empty or changed structure/);
  });

  test("an article that keeps failing keeps its saved copy while the others update", async () => {
    const { world, c, first } = await goodRun();
    world.details.set(3, { ...tagged(3), body: "<p>New text for three</p>" });
    world.details.set(2, { ...tagged(2), body: "<p>New text for two</p>" });
    world.bump("/news/3");
    world.bump("/news/2");
    world.fail(
      "/news/3",
      async () => reply(500),
      async () => reply(500),
      async () => reply(500),
    );
    const result = await refreshNews(deps(world, c));
    expect(result.fromCache).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/Article 3 .*HTTP 500.*Kept the saved copy/);
    expect(result.articles.find((a) => a.id === 3)).toEqual(first.articles.find((a) => a.id === 3));
    expect(result.articles.find((a) => a.id === 2)?.body).toBe("New text for two");
  });

  test("an article whose body is HTML-instead-of-JSON or malformed is reported, not shown", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    world.fail("/news/1", async () => reply(200, "<html>"));
    world.details.set(2, { ...tagged(2), body: "" }); // fails validateItem(detail)
    world.details.set(3, { ...tagged(3), id: 99, body: "<p>x</p>" }); // id mismatch
    const result = await refreshNews(deps(world, c));
    expect(result.articles.map((a) => a.id).sort((a, b) => a - b)).toEqual([101, 102]);
    expect(result.problems.join("\n")).toMatch(/Article 1 .*HTML or invalid JSON/);
    expect(result.problems.join("\n")).toMatch(/Article 2 .*empty article body/);
    expect(result.problems.join("\n")).toMatch(/Article 3 .*mismatch/);
  });

  test("a failing archive does not stop the live news, and is retried next time", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    world.fail(
      "/archived",
      async () => reply(500),
      async () => reply(500),
      async () => reply(500),
    );
    const first = await refreshNews(deps(world, c));
    expect(first.fromCache).toBe(false);
    expect(first.articles.map((a) => a.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(first.problems.join(" ")).toMatch(/archive could not be refreshed.*HTTP 500/);
    world.resetLog();
    const second = await refreshNews(deps(world, c));
    expect(world.count("/archived")).toBe(1); // still due: the first run never recorded a good archive check
    expect(second.articles).toHaveLength(5);
    expect(second.problems).toEqual([]);
  });

  test("a timeout is retried and then reported; the request is aborted", async () => {
    const { world, c, first } = await goodRun();
    const signals: Array<AbortSignal | undefined> = [];
    const hang = () => {
      signals.push(world.log[world.log.length - 1]?.init.signal);
      return new Promise<FetchResponse>(() => undefined); // never settles, ignores the signal
    };
    world.fail(
      "/news",
      async () => hang(),
      async () => hang(),
      async () => hang(),
    );
    const result = await refreshNews(deps(world, c, { timeoutMs: 15 }));
    expect(world.count("/news")).toBe(3);
    expect(result.fromCache).toBe(true);
    expect(result.articles).toEqual(first.articles);
    expect(result.problems.join(" ")).toMatch(/Timed out/);
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s?.aborted === true)).toBe(true);
  });

  test("the default timeout is 30 seconds", async () => {
    const { TIMEOUT_MS } = await import("./client");
    expect(TIMEOUT_MS).toBe(30_000);
  });

  test("offline on a first run: nothing saved, nothing shown, three attempts", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    world.fail(
      "/news",
      ...[1, 2, 3].map(() => async (): Promise<FetchResponse> => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await refreshNews(deps(world, c));
    expect(result).toMatchObject({ articles: [], fetchedAt: null, fromCache: true });
    expect(result.problems.join(" ")).toMatch(/Failed to fetch.*Nothing is saved yet/);
    expect(world.count("/news")).toBe(3);
    expect(c.files.size).toBe(0);
  });

  test("a cancelled refresh returns the saved news", async () => {
    const { world, c, first } = await goodRun();
    const controller = new AbortController();
    controller.abort();
    const result = await refreshNews(deps(world, c), { signal: controller.signal });
    expect(world.log).toHaveLength(0);
    expect(result).toMatchObject({ fromCache: true, articles: first.articles });
    expect(result.problems.join(" ")).toMatch(/cancelled/);
  });
});

describe("guard rails", () => {
  async function goodRun() {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    const first = await refreshNews(deps(world, c));
    world.resetLog();
    world.clock.t += 30 * 60_000;
    return { world, c, first };
  }

  test("an empty index aborts the refresh", async () => {
    const { world, c, first } = await goodRun();
    world.news.length = 0;
    world.bump("/news");
    const result = await refreshNews(deps(world, c));
    expect(result).toMatchObject({
      fromCache: true,
      articles: first.articles,
      fetchedAt: first.fetchedAt,
    });
    expect(result.problems.join(" ")).toMatch(/empty or changed structure/);
    expect(world.paths()).toEqual(["/news"]); // no article requests
  });

  test("an empty index on the very first run saves nothing", async () => {
    const world = makeWorld();
    const c = makeCache();
    world.fail("/news", async () => reply(200, "[]"));
    const result = await refreshNews(deps(world, c));
    expect(result).toMatchObject({ articles: [], fetchedAt: null, fromCache: true });
    expect(c.files.size).toBe(0);
  });

  test("an index that shrinks by more than 10 % aborts; exactly 10 % is accepted", async () => {
    const { world, c, first } = await goodRun();
    const full = [...world.news];
    world.news.splice(10, 3); // 20 -> 17
    world.bump("/news");
    const aborted = await refreshNews(deps(world, c));
    expect(aborted).toMatchObject({ fromCache: true, articles: first.articles });
    expect(aborted.problems.join(" ")).toMatch(/shrank from 20 to 17/);
    expect(world.paths()).toEqual(["/news"]);

    // The rejected index was not saved as the new baseline: 18 items is still compared with 20.
    world.news.length = 0;
    world.news.push(...full.slice(0, 18));
    world.bump("/news");
    const ok = await refreshNews(deps(world, c));
    expect(ok.fromCache).toBe(false);
    expect(ok.problems).toEqual([]);
  });

  test("acceptShrink lets a confirmed shrink through", async () => {
    const { world, c } = await goodRun();
    world.news.splice(10, 5); // 20 -> 15
    world.bump("/news");
    expect((await refreshNews(deps(world, c))).fromCache).toBe(true);
    const accepted = await refreshNews(deps(world, c), { acceptShrink: true });
    expect(accepted.fromCache).toBe(false);
    // The new, smaller index is now the baseline.
    expect((await refreshNews(deps(world, c))).fromCache).toBe(false);
  });

  test("an index with no Classic tag anywhere aborts", async () => {
    const world = makeWorld();
    const c = makeCache();
    for (let id = 1; id <= 20; id++)
      world.news.push(id <= 3 ? item(id, { name: `Classic World notice ${id}` }) : item(id));
    for (let id = 101; id <= 110; id++) world.archived.push(item(id));
    const result = await refreshNews(deps(world, c));
    expect(result).toMatchObject({ articles: [], fromCache: true });
    expect(result.problems.join(" ")).toMatch(/no official Classic World tags/);
    expect(world.paths()).toEqual(["/news", "/archived"]);
    expect(c.files.size).toBe(0);
  });

  test("losing the tag from the live news is fine while the saved archive still has tagged items", async () => {
    const { world, c } = await goodRun();
    for (const n of world.news) n.isMSCW = false; // tags gone, titles still say "Classic World"
    world.bump("/news");
    const result = await refreshNews(deps(world, c));
    expect(result.fromCache).toBe(false);
    expect(result.articles.some((a) => a.id === 101)).toBe(true);
  });

  test("a few malformed items are skipped; many mean the structure changed", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    const bad = { id: "x", name: 5 } as unknown as NexonItem;
    world.news.push(bad); // 1 of 21 malformed
    const ok = await refreshNews(deps(world, c));
    expect(ok.fromCache).toBe(false);
    expect(ok.problems.join(" ")).toMatch(/1 malformed item\(s\) in the news index were skipped/);
    expect(ok.articles).toHaveLength(5);

    const world2 = makeWorld();
    const c2 = makeCache();
    seed(world2);
    world2.news.push(bad, bad, bad); // 3 of 23 > 10 %
    const aborted = await refreshNews(deps(world2, c2));
    expect(aborted.fromCache).toBe(true);
    expect(aborted.problems.join(" ")).toMatch(/malformed; its structure may have changed/);
  });

  test("duplicate ids are skipped", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    world.news.push(tagged(1, { name: "Classic World notice 1 (again)" }));
    const result = await refreshNews(deps(world, c));
    expect(result.fromCache).toBe(false);
    expect(result.articles.filter((a) => a.id === 1)).toHaveLength(1);
    expect(world.count("/news/1")).toBe(1);
  });

  test("only the official feed host is ever contacted", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    const urls: string[] = [];
    const spy: Fetcher = (url, init) => {
      urls.push(url);
      return world.fetcher(url, init);
    };
    await refreshNews({ ...deps(world, c), fetcher: spy });
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls)
      expect(u.startsWith("https://g.nexonstatic.com/maplestory/cms/v1/")).toBe(true);
  });
});

describe("articles Nexon stops listing", () => {
  test("stay visible, marked 'Not listed'", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    await refreshNews(deps(world, c));
    world.news.splice(
      world.news.findIndex((n) => n.id === 3),
      1,
    ); // 20 -> 19: within 10 %
    world.bump("/news");
    world.clock.t += 30 * 60_000;
    const result = await refreshNews(deps(world, c));
    expect(result.fromCache).toBe(false);
    expect(result.articles.find((a) => a.id === 3)).toMatchObject({
      change: "Not listed",
      availability: "Not in current feeds",
    });
    expect(result.articles.find((a) => a.id === 1)?.availability).toBe("Verified");
  });
});

describe("cache trouble", () => {
  test("an unreadable snapshot is ignored with a problem, then rebuilt", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    c.files.set("news-state", "{not json");
    c.files.set("index-news", JSON.stringify({ nonsense: true }));
    const result = await refreshNews(deps(world, c));
    expect(result.fromCache).toBe(false);
    expect(result.problems.join(" ")).toMatch(/news snapshot was unreadable/);
    expect(result.problems.join(" ")).toMatch(/news index was unreadable/);
    expect(result.articles).toHaveLength(5);
    expect(JSON.parse(c.files.get("news-state") ?? "null")).toMatchObject({ schema: 1 });
  });

  test("a saved article that no longer validates cannot be kept alive by a 304", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    await refreshNews(deps(world, c));
    const stored = JSON.parse(c.files.get("article-1") ?? "null") as {
      data: Record<string, unknown>;
    };
    stored.data.body = "";
    c.files.set("article-1", JSON.stringify(stored));
    world.resetLog();
    world.clock.t += 30 * 60_000;
    const result = await refreshNews(deps(world, c));
    expect(world.log.find((l) => l.path === "/news/1")?.headers["If-None-Match"]).toBeUndefined();
    expect(result.problems).toEqual([]);
    expect(result.articles.find((a) => a.id === 1)?.body).toMatch(/^Body of/);
  });

  test("a failing cache write is reported but the fresh result is still returned", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    c.failWrites(true);
    const result = await refreshNews(deps(world, c));
    expect(result.fromCache).toBe(false);
    expect(result.articles).toHaveLength(5);
    expect(result.problems.join(" ")).toMatch(/Could not save news snapshot: disk full/);
  });

  test("a cache whose read throws is treated as empty", async () => {
    const world = makeWorld();
    seed(world);
    const c = makeCache();
    const cache: NewsCache = {
      read: async () => {
        throw new Error("locked");
      },
      write: c.cache.write,
    };
    const result = await refreshNews({ ...deps(world, c), cache });
    expect(result.fromCache).toBe(false);
    expect(result.problems.join(" ")).toMatch(/could not be read: locked/);
  });
});

describe("concurrency", () => {
  test("simultaneous refreshes share one run", async () => {
    const world = makeWorld();
    const c = makeCache();
    seed(world);
    const d = deps(world, c);
    const [a, b] = await Promise.all([refreshNews(d), refreshNews(d)]);
    expect(a).toBe(b);
    expect(world.count("/news")).toBe(1);
    // ...and a later call starts a fresh run.
    world.clock.t += 30 * 60_000;
    await refreshNews(d);
    expect(world.count("/news")).toBe(2);
  });
});
