import { create } from "zustand";
import type { Platform } from "../platform/types";
import type { Pack } from "../data/pack";
import { checkForAppUpdate, checkForPackUpdate, manifestOf, type AppRelease, type FeedFetch, type Manifest } from "../data/updateClient";
import pkg from "../../package.json";

// Live update loop (plan §7.2 / P8-T4): on launch and every 30 minutes while open. Never blocks the UI.

export const CHECK_EVERY_MS = 30 * 60_000;

export type PackStatus = "idle" | "checking" | "fresh" | "offline" | "app-update-needed";

type UpdatesState = {
  status: PackStatus;
  lastChecked: string | null;
  problem: string | null;
  appRelease: AppRelease | null;
  etag: string | null;
  /** Set by App once the update loop is running. */
  checkNow: (() => void) | null;
  setStatus(p: Partial<Omit<UpdatesState, "setStatus">>): void;
};

export const useUpdates = create<UpdatesState>()((set) => ({
  status: "idle",
  lastChecked: null,
  problem: null,
  appRelease: null,
  etag: null,
  checkNow: null,
  setStatus: (p) => set(p),
}));

/** HTTP for the GitHub Pages feed: Rust-side in the exe (allow-listed, no CORS), global fetch elsewhere. */
export async function makeFeedFetch(platform: Platform): Promise<FeedFetch> {
  const doFetch: typeof fetch =
    platform.kind === "tauri" ? ((await import("@tauri-apps/plugin-http")).fetch as unknown as typeof fetch) : (...a) => fetch(...a);
  return async (url, { timeoutMs, etag }) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { headers: etag ? { "If-None-Match": etag } : {}, signal: ctl.signal, cache: "no-store" });
      const buf = res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array();
      return { status: res.status, etag: res.headers.get("etag"), text: async () => new TextDecoder().decode(buf), bytes: async () => buf };
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function appVersionOf(platform: Platform): Promise<string> {
  return platform.kind === "tauri" ? platform.appVersion().catch(() => pkg.version) : pkg.version;
}

/** One check: guide data first, then the app version. Calls `onInstalled` with the new pack to hot-swap it. */
export async function runUpdateCheck(opts: {
  platform: Platform;
  fetchFn: FeedFetch;
  appVersion: string;
  from: "installed" | "bundled";
  onInstalled: (pack: Pack, version: string) => void;
}) {
  const st = useUpdates.getState();
  if (st.status === "checking") return;
  st.setStatus({ status: "checking" });
  const readActive =
    opts.from === "installed"
      ? async (file: string) => JSON.parse(await opts.platform.packRead(file))
      : async (file: string) => {
          const r = await fetch(`baseline/${file}`);
          if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
          return r.json();
        };
  const activeManifest: Manifest | null = await manifestOf(readActive);
  const out = await checkForPackUpdate({
    platform: opts.platform,
    fetch: opts.fetchFn,
    appVersion: opts.appVersion,
    activeManifest,
    activeFrom: opts.from,
    readActive,
    etag: st.etag,
  });
  const etag = "etag" in out && out.etag !== undefined ? out.etag : st.etag;
  const appRelease = await checkForAppUpdate(opts.fetchFn, opts.appVersion);
  const now = new Date().toISOString();
  switch (out.kind) {
    case "installed":
      opts.onInstalled(out.pack, out.version);
      useUpdates.getState().setStatus({ status: "fresh", lastChecked: now, problem: null, etag, appRelease });
      break;
    case "up-to-date":
    case "not-modified":
      useUpdates.getState().setStatus({ status: "fresh", lastChecked: now, problem: null, etag, appRelease });
      break;
    case "app-update-needed":
      useUpdates.getState().setStatus({ status: "app-update-needed", lastChecked: now, problem: `Guide data ${out.feedVersion} needs app ${out.minAppVersion}+`, etag, appRelease });
      break;
    default:
      useUpdates.getState().setStatus({ status: "offline", lastChecked: now, problem: out.problem, etag, appRelease });
  }
}
