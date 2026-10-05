import { create } from "zustand";
import type { Platform } from "../../platform/types";
import { loadCachedNews, refreshNews, type Fetcher, type NewsClientDeps, type NewsResult } from "./client";

// App-side news state (P7): cached copy first, then a live refresh on launch, every 30 minutes, and on demand.

export const NEWS_REFRESH_MS = 30 * 60_000;

export type NewsStatus = "idle" | "checking" | "fresh" | "offline";

type NewsStore = {
  status: NewsStatus;
  result: NewsResult | null;
  lastAttempt: string | null;
  start(deps: NewsClientDeps): Promise<void>;
  refresh(): Promise<void>;
};

let deps: NewsClientDeps | null = null;

export const useNews = create<NewsStore>()((set, get) => ({
  status: "idle",
  result: null,
  lastAttempt: null,
  async start(d) {
    deps = d;
    try {
      const cached = await loadCachedNews(d.cache);
      if (cached.articles.length) set({ result: cached });
    } catch {
      // no cache yet
    }
    await get().refresh();
  },
  async refresh() {
    if (!deps || get().status === "checking") return;
    set({ status: "checking" });
    const r = await refreshNews(deps);
    set({ result: r, status: r.fromCache ? "offline" : "fresh", lastAttempt: new Date().toISOString() });
  },
}));

/** Tauri: Rust-side HTTP (allow-listed hosts, no CORS); browser/tests: the global fetch. */
export async function makeFetcher(platform: Platform): Promise<Fetcher> {
  if (platform.kind === "tauri") {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return (url, init) => tauriFetch(url, { method: "GET", headers: init.headers, signal: init.signal }) as unknown as ReturnType<Fetcher>;
  }
  return (url, init) => fetch(url, { method: "GET", headers: init.headers, signal: init.signal, redirect: init.redirect });
}

export function newsDeps(platform: Platform, fetcher: Fetcher, appVersion: string): NewsClientDeps {
  return {
    fetcher,
    appVersion,
    cache: { read: (k) => platform.cacheRead(k), write: (k, j) => platform.cacheWrite(k, j) },
  };
}
