import type { ZodType } from "zod";
import { API, matchReason, normalize, validateItem, type NexonItem } from "./core";
import {
  ArticleCacheSchema,
  IndexCacheSchema,
  NewsStateSchema,
  type Article,
  type IndexCache,
  type NewsState,
} from "./schema";

// News client (plan §6.1 Tier A, P7-T2; ported from Astra `core.mjs` getJSON/collect).
//
// Polite by construction: one request at a time, >= 180 ms apart, ETag / If-Modified-Since on every
// request, 3 attempts with backoff (1 s, 2 s) for 429 / 5xx / network errors / timeouts, 30 s timeout,
// and only the official public feed host. All I/O is injected (`Fetcher`, `NewsCache`) so the app can
// wire it to Tauri commands and tests can mock it.
//
// Everything fetched is untrusted: parsed as JSON, validated (`validateItem`), reduced to plain text
// (`normalize`) and never turned into HTML. If anything looks wrong the refresh is abandoned and the
// last good data is returned together with a human-readable problem.

export type { Article } from "./schema";

// ---------------------------------------------------------------------------------------------
// Injected I/O
// ---------------------------------------------------------------------------------------------

export interface FetchInit {
  method?: "GET";
  headers: Record<string, string>;
  redirect?: "error" | "follow" | "manual";
  signal?: AbortSignal;
}

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** The global `fetch` satisfies this; so does a thin wrapper over `@tauri-apps/plugin-http`. */
export type Fetcher = (url: string, init: FetchInit) => Promise<FetchResponse>;

/** Persistent JSON text store. Keys match `^[a-z0-9-]{1,64}$` (they become file names in `cache\news\`). */
export interface NewsCache {
  /** `null` when there is no such entry. */
  read(key: string): Promise<string | null>;
  write(key: string, json: string): Promise<void>;
}

export interface NewsClientDeps {
  fetcher: Fetcher;
  cache: NewsCache;
  /** App version, for the User-Agent (`MapleClassicCompanion/<version> (personal news reader)`). */
  appVersion: string;
  /** Milliseconds since the epoch. Default `Date.now`. */
  now?: () => number;
  /** Default: `setTimeout`. Used for pacing and retry backoff. */
  sleep?: (ms: number) => Promise<void>;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
}

export interface RefreshOptions {
  signal?: AbortSignal;
  /** Fetch `/archived` even if it was fetched less than a week ago. */
  forceArchive?: boolean;
  /** Accept an index that shrank by more than 10 % (use after the person confirms Nexon really did that). */
  acceptShrink?: boolean;
}

export interface NewsResult {
  articles: Article[];
  /** ISO time of the last successful refresh, or `null` if there never was one. */
  fetchedAt: string | null;
  /**
   * `true` when `articles` are the saved copy rather than the result of this call — the refresh was
   * abandoned (offline, HTTP error, guard rail, cancelled). `problems` says why.
   */
  fromCache: boolean;
  problems: string[];
}

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

export const PACE_MS = 180;
/** Total attempts per request (1 try + 2 retries), as Astra. Backoff before retry n is n seconds. */
export const MAX_ATTEMPTS = 3;
export const TIMEOUT_MS = 30_000;
export const ARCHIVE_INTERVAL_MS = 7 * 86_400_000;
const MAX_RESPONSE_CHARS = 12_000_000;
/** An index shorter than this fraction of the last good one is rejected. */
const SHRINK_FLOOR = 0.9;
/** More malformed index items than this fraction means the feed's structure changed. */
const INVALID_CEILING = 0.1;

/** Cache keys used by this client (files in `cache\news\`). All match `^[a-z0-9-]{1,64}$`. */
export const NEWS_CACHE_KEYS = {
  state: "news-state",
  newsIndex: "index-news",
  archiveIndex: "index-archived",
  article: (id: number): string => `article-${id}`,
} as const;

const KEY_RX = /^[a-z0-9-]{1,64}$/;

export const userAgent = (appVersion: string): string =>
  `MapleClassicCompanion/${appVersion.replace(/[^\w.+-]/g, "") || "0"} (personal news reader)`;

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

const inflight = new WeakMap<NewsCache, Promise<NewsResult>>();

/** The saved result (what to show at launch, before any network). Never throws. */
export async function loadCachedNews(cache: NewsCache): Promise<NewsResult> {
  const problems: string[] = [];
  const state = await readEntry(
    cache,
    NEWS_CACHE_KEYS.state,
    NewsStateSchema,
    problems,
    "news snapshot",
  );
  return {
    articles: state?.articles ?? [],
    fetchedAt: state?.fetchedAt ?? null,
    fromCache: true,
    problems,
  };
}

/**
 * Refreshes the Classic World news. Never throws: on any failure the last good data comes back with
 * `fromCache: true` and a `problems` entry. Concurrent calls on the same cache share one run.
 */
export function refreshNews(
  deps: NewsClientDeps,
  options: RefreshOptions = {},
): Promise<NewsResult> {
  const running = inflight.get(deps.cache);
  if (running) return running;
  const run = runRefresh(deps, options).finally(() => inflight.delete(deps.cache));
  inflight.set(deps.cache, run);
  return run;
}

// ---------------------------------------------------------------------------------------------
// Requests: pacing, retries, timeout, ETag
// ---------------------------------------------------------------------------------------------

interface Ctx {
  fetcher: Fetcher;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  userAgent: string;
  signal: AbortSignal | undefined;
  nextRequestAt: number;
}

/** Validators from an earlier response, plus the data to hand back on 304. */
interface Revalidation {
  etag: string | null;
  lastModified: string | null;
  data: unknown;
}

interface Fetched {
  data: unknown;
  etag: string | null;
  lastModified: string | null;
  checkedAt: string;
  notModified: boolean;
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

/** Thrown to abandon a refresh; the message is shown to the person. */
class RefreshAbort extends Error {}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function pace(ctx: Ctx): Promise<void> {
  const now = ctx.now();
  const scheduled = Math.max(now, ctx.nextRequestAt);
  ctx.nextRequestAt = scheduled + PACE_MS;
  if (scheduled > now) await ctx.sleep(scheduled - now);
}

async function requestOnce(
  ctx: Ctx,
  url: string,
  revalidate: Revalidation | null,
): Promise<Fetched> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": ctx.userAgent,
  };
  if (revalidate?.etag) headers["If-None-Match"] = revalidate.etag;
  if (revalidate?.lastModified) headers["If-Modified-Since"] = revalidate.lastModified;

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(ctx.signal?.reason);
  ctx.signal?.addEventListener("abort", forwardAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        `Timed out after ${Math.round(ctx.timeoutMs / 1000)} s waiting for Nexon.`,
      );
      error.name = "TimeoutError";
      controller.abort(error);
      reject(error);
    }, ctx.timeoutMs);
  });

  const exchange = async (): Promise<Fetched> => {
    const response = await ctx.fetcher(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    const checkedAt = new Date(ctx.now()).toISOString();
    if (response.status === 304 && revalidate) {
      return {
        data: revalidate.data,
        etag: revalidate.etag,
        lastModified: revalidate.lastModified,
        checkedAt,
        notModified: true,
      };
    }
    if (response.status < 200 || response.status > 299) {
      throw new RequestError(
        `Nexon returned HTTP ${response.status} for ${url}`,
        response.status === 429 || response.status >= 500,
      );
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS)
      throw new RequestError("Unexpectedly large Nexon response.", false);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new RequestError(
        "Nexon returned HTML or invalid JSON instead of the news feed.",
        false,
      );
    }
    return {
      data,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      checkedAt,
      notModified: false,
    };
  };

  try {
    return await Promise.race([exchange(), timedOut]);
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", forwardAbort);
  }
}

/** GET + JSON with pacing, ETag revalidation, retries and a timeout. Only the official feed is allowed. */
async function getJSON(ctx: Ctx, url: string, revalidate: Revalidation | null): Promise<Fetched> {
  if (!url.startsWith(API + "/"))
    throw new Error("Refusing a request outside the official public news feed.");
  for (let attempt = 1; ; attempt++) {
    if (ctx.signal?.aborted) throw new RefreshAbort("Refresh cancelled.");
    await pace(ctx);
    try {
      return await requestOnce(ctx, url, revalidate);
    } catch (error) {
      const retryable = error instanceof RequestError ? error.retryable : true; // network errors, timeouts
      if (ctx.signal?.aborted) throw new RefreshAbort("Refresh cancelled.");
      if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
      await ctx.sleep(1000 * attempt);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------------------------

/** Reads and validates one cache entry. Anything unreadable counts as "no entry". */
async function readEntry<T>(
  cache: NewsCache,
  key: string,
  schema: ZodType<T>,
  problems: string[] | null,
  label: string,
): Promise<T | null> {
  let raw: string | null;
  try {
    if (!KEY_RX.test(key)) throw new Error(`invalid cache key ${key}`);
    raw = await cache.read(key);
  } catch (error) {
    problems?.push(`Saved ${label} could not be read: ${messageOf(error)}`);
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through: corrupt JSON
  }
  problems?.push(`Saved ${label} was unreadable and was ignored.`);
  return null;
}

/** A saved article that no longer validates is ignored, so a 304 can never keep it alive. */
async function readUsableArticle(cache: NewsCache, key: string) {
  const stored = await readEntry(cache, key, ArticleCacheSchema, null, "article");
  if (!stored) return null;
  try {
    validateItem(stored.data, true);
    return stored;
  } catch {
    return null;
  }
}

async function writeEntry(
  cache: NewsCache,
  key: string,
  value: unknown,
  problems: string[],
  label: string,
) {
  try {
    if (!KEY_RX.test(key)) throw new Error(`invalid cache key ${key}`);
    await cache.write(key, JSON.stringify(value));
  } catch (error) {
    problems.push(`Could not save ${label}: ${messageOf(error)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Index lists (`/news`, `/archived`)
// ---------------------------------------------------------------------------------------------

type IndexPart = "news" | "archived";

type IndexOutcome =
  | { ok: true; entry: IndexCache; items: NexonItem[]; fresh: boolean; skipped: number }
  | { ok: false; reason: string };

const itemsOf = (entry: IndexCache): NexonItem[] =>
  entry.items.flatMap((raw) => {
    try {
      return [validateItem(raw)];
    } catch {
      return [];
    }
  });

/** A saved index whose items no longer validate is dropped, so a 304 can never keep it alive. */
const usableIndex = (entry: IndexCache | null): IndexCache | null =>
  entry && itemsOf(entry).length === entry.items.length ? entry : null;

/**
 * Fetches one index and applies the guard rails: it must be a non-empty list, mostly well-formed, and
 * not much shorter than the last good one. Returns only the items that match Classic World.
 */
async function loadIndex(
  ctx: Ctx,
  part: IndexPart,
  cached: IndexCache | null,
  acceptShrink: boolean,
): Promise<IndexOutcome> {
  let fetched: Fetched;
  try {
    fetched = await getJSON(
      ctx,
      `${API}/${part}`,
      cached ? { etag: cached.etag, lastModified: cached.lastModified, data: cached } : null,
    );
  } catch (error) {
    if (error instanceof RefreshAbort) throw error;
    return { ok: false, reason: messageOf(error) };
  }
  if (fetched.notModified && cached) {
    return {
      ok: true,
      entry: { ...cached, checkedAt: fetched.checkedAt },
      items: itemsOf(cached),
      fresh: false,
      skipped: 0,
    };
  }

  const list = fetched.data;
  if (!Array.isArray(list) || list.length === 0)
    return { ok: false, reason: `the ${part} feed is empty or changed structure.` };

  const valid: NexonItem[] = [];
  const seen = new Set<number>();
  let skipped = 0;
  for (const raw of list as unknown[]) {
    try {
      const item = validateItem(raw);
      if (seen.has(item.id)) throw new Error("duplicate");
      seen.add(item.id);
      valid.push(item);
    } catch {
      skipped++;
    }
  }
  if (skipped > list.length * INVALID_CEILING)
    return {
      ok: false,
      reason: `${skipped} of ${list.length} items in the ${part} feed were malformed; its structure may have changed.`,
    };
  if (cached && !acceptShrink && list.length < cached.count * SHRINK_FLOOR)
    return {
      ok: false,
      reason: `the ${part} feed shrank from ${cached.count} to ${list.length} items (more than 10 %).`,
    };

  const items = valid.filter((item) => matchReason(item) !== null);
  const entry: IndexCache = {
    etag: fetched.etag,
    lastModified: fetched.lastModified,
    checkedAt: fetched.checkedAt,
    count: list.length,
    items,
  };
  return { ok: true, entry, items, fresh: true, skipped };
}

// ---------------------------------------------------------------------------------------------
// The refresh
// ---------------------------------------------------------------------------------------------

async function runRefresh(deps: NewsClientDeps, options: RefreshOptions): Promise<NewsResult> {
  const { cache } = deps;
  const problems: string[] = [];
  const state = await readEntry(
    cache,
    NEWS_CACHE_KEYS.state,
    NewsStateSchema,
    problems,
    "news snapshot",
  );
  try {
    return await refreshInner(deps, options, state, problems);
  } catch (error) {
    const reason =
      error instanceof RefreshAbort ? error.message : `unexpected error: ${messageOf(error)}`;
    problems.push(
      `Nexon news could not be refreshed: ${reason} ${state ? "Showing the saved news." : "Nothing is saved yet."}`,
    );
    return {
      articles: state?.articles ?? [],
      fetchedAt: state?.fetchedAt ?? null,
      fromCache: true,
      problems,
    };
  }
}

async function refreshInner(
  deps: NewsClientDeps,
  options: RefreshOptions,
  state: NewsState | null,
  problems: string[],
): Promise<NewsResult> {
  const { cache } = deps;
  const ctx: Ctx = {
    fetcher: deps.fetcher,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
    userAgent: userAgent(deps.appVersion),
    signal: options.signal,
    nextRequestAt: 0,
  };
  const acceptShrink = options.acceptShrink === true;
  const previous = new Map((state?.articles ?? []).map((a) => [a.id, a]));

  // 1. The live news index. Without a good one there is nothing to update.
  const cachedNews = usableIndex(
    await readEntry(cache, NEWS_CACHE_KEYS.newsIndex, IndexCacheSchema, problems, "news index"),
  );
  const news = await loadIndex(ctx, "news", cachedNews, acceptShrink);
  if (!news.ok) throw new RefreshAbort(news.reason);
  if (news.skipped)
    problems.push(`${news.skipped} malformed item(s) in the news index were skipped.`);

  // 2. The archive: first run and then weekly. If it fails, the saved archive matches are used.
  const cachedArchive = usableIndex(
    await readEntry(
      cache,
      NEWS_CACHE_KEYS.archiveIndex,
      IndexCacheSchema,
      problems,
      "archive index",
    ),
  );
  let archiveEntry = cachedArchive;
  let archiveItems = cachedArchive ? itemsOf(cachedArchive) : [];
  let archiveCheckedAt = state?.archiveCheckedAt ?? null;
  const lastArchive = archiveCheckedAt ? Date.parse(archiveCheckedAt) : NaN;
  const archiveDue =
    options.forceArchive === true ||
    !state ||
    !Number.isFinite(lastArchive) ||
    ctx.now() - lastArchive >= ARCHIVE_INTERVAL_MS;
  let archiveFresh = false;
  if (archiveDue) {
    const archive = await loadIndex(ctx, "archived", cachedArchive, acceptShrink);
    if (archive.ok) {
      archiveEntry = archive.entry;
      archiveItems = archive.items;
      archiveFresh = archive.fresh;
      archiveCheckedAt = new Date(ctx.now()).toISOString();
      if (archive.skipped)
        problems.push(`${archive.skipped} malformed item(s) in the archive index were skipped.`);
    } else {
      problems.push(
        `Nexon archive could not be refreshed: ${archive.reason} Using the saved archive.`,
      );
    }
  }

  // 3. Guard rail: Nexon's own Classic tag must still exist somewhere.
  if (![...news.items, ...archiveItems].some((item) => item.isMSCW === true))
    throw new RefreshAbort(
      "no official Classic World tags (isMSCW) found; the source may have changed.",
    );

  // 4. Candidates: every index item that matched Classic World. Live news wins over the archive.
  const candidates = new Map<number, NexonItem & { feed: IndexPart }>();
  for (const [feed, items] of [
    ["news", news.items],
    ["archived", archiveItems],
  ] as const) {
    for (const item of items) {
      const existing = candidates.get(item.id);
      if (!existing) candidates.set(item.id, { ...item, feed });
      else if (existing.name !== item.name || existing.liveDate !== item.liveDate)
        problems.push(`Conflicting records for article ${item.id}; the live news entry was used.`);
    }
  }
  const ordered = [...candidates.values()].sort(
    (a, b) => Date.parse(b.liveDate) - Date.parse(a.liveDate) || b.id - a.id,
  );

  // 5. Each candidate's full article, revalidated with its ETag.
  const articles: Article[] = [];
  for (const item of ordered) {
    if (ctx.signal?.aborted) throw new RefreshAbort("Refresh cancelled.");
    const key = NEWS_CACHE_KEYS.article(item.id);
    const old = previous.get(item.id);
    try {
      const stored = await readUsableArticle(cache, key);
      const response = await getJSON(
        ctx,
        `${API}/news/${item.id}`,
        stored ? { etag: stored.etag, lastModified: stored.lastModified, data: stored.data } : null,
      );
      const detail = validateItem(response.data, true);
      if (detail.id !== item.id)
        throw new Error(`article ID mismatch (asked for ${item.id}, got ${detail.id}).`);
      if (!response.notModified) {
        await writeEntry(
          cache,
          key,
          {
            data: response.data,
            etag: response.etag,
            lastModified: response.lastModified,
            checkedAt: response.checkedAt,
          },
          problems,
          `article ${item.id}`,
        );
      }
      const article = await normalize(detail, item, response.checkedAt, old);
      if (article) articles.push(article);
    } catch (error) {
      if (error instanceof RefreshAbort) throw error;
      problems.push(
        `Article ${item.id} (${item.name.slice(0, 60)}) could not be refreshed: ${messageOf(error)}${old ? " Kept the saved copy." : ""}`,
      );
      if (old) articles.push(old);
    }
  }

  // 6. Articles Nexon no longer lists stay visible, marked as such.
  for (const old of previous.values()) {
    if (!candidates.has(old.id))
      articles.push({ ...old, change: "Not listed", availability: "Not in current feeds" });
  }
  if (articles.length === 0) throw new RefreshAbort("no Classic World articles could be loaded.");
  articles.sort((a, b) => Date.parse(b.publishedUTC) - Date.parse(a.publishedUTC) || b.id - a.id);

  // 7. Commit. The indexes and the snapshot are only saved once everything above worked, so an
  //    abandoned refresh never changes what the guard rails compare against.
  const fetchedAt = new Date(ctx.now()).toISOString();
  if (news.fresh)
    await writeEntry(cache, NEWS_CACHE_KEYS.newsIndex, news.entry, problems, "news index");
  if (archiveFresh && archiveEntry)
    await writeEntry(cache, NEWS_CACHE_KEYS.archiveIndex, archiveEntry, problems, "archive index");
  const next: NewsState = { schema: 1, fetchedAt, archiveCheckedAt, articles };
  await writeEntry(cache, NEWS_CACHE_KEYS.state, next, problems, "news snapshot");
  return { articles, fetchedAt, fromCache: false, problems };
}
