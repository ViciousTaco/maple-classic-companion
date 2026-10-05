import type { Platform } from "../platform/types";
import { bundledSource, loadPack, parsePack, type LoadResult, type Pack, type PackSource } from "./pack";
import { PACK_FILES, type PackKey } from "./schema/pack";
import { PACK_KEYS } from "./validate";

// Plan §8.6 steps 1–7 (UI side) + P8-T6 app version check. Rust verifies signatures and hashes again.

export const FEED_BASE = "https://vicioustaco.github.io/maple-classic-companion/";
export const MANIFEST_TIMEOUT_MS = 8000;

export type ManifestFile = { path: string; sha256: string; bytes: number };
export type Manifest = {
  schema: number;
  packVersion: string;
  builtAt: string;
  minAppVersion: string;
  gameLabel: string;
  reviewedThroughArticleId: number;
  files: ManifestFile[];
};

export type FeedFetch = (url: string, opts: { timeoutMs: number; etag?: string | null }) => Promise<{ status: number; etag: string | null; text(): Promise<string>; bytes(): Promise<Uint8Array> }>;

export type UpdateOutcome =
  | { kind: "offline"; problem: string }
  | { kind: "not-modified" }
  | { kind: "up-to-date"; feedVersion: string }
  | { kind: "rejected"; problem: string }
  | { kind: "app-update-needed"; feedVersion: string; minAppVersion: string }
  | { kind: "installed"; pack: Pack; version: string };

/** "2026.10.07-1" → [2026, 10, 7, 1]; compared as a tuple (§8.6 step 3). */
export function versionTuple(v: string): number[] {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})-(\d+)$/.exec(v);
  return m ? m.slice(1).map(Number) : [0, 0, 0, 0];
}
export function comparePackVersions(a: string, b: string): number {
  const x = versionTuple(a);
  const y = versionTuple(b);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}
/** Semver-ish "1.2.3" comparison. */
export function compareAppVersions(a: string, b: string): number {
  const p = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const x = p(a);
  const y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

const decoder = new TextDecoder();

export type UpdateDeps = {
  platform: Platform;
  fetch: FeedFetch;
  appVersion: string;
  /** Manifest of the pack the app is using right now (installed or bundled). */
  activeManifest: Manifest | null;
  activeFrom: "installed" | "bundled";
  /** Reads an unchanged file from the active pack. */
  readActive: (file: string) => Promise<unknown>;
  etag?: string | null;
  base?: string;
};

export async function checkForPackUpdate(d: UpdateDeps): Promise<UpdateOutcome & { etag?: string | null }> {
  const base = d.base ?? FEED_BASE;
  // Step 1
  let manifestText: string;
  let signature: string;
  let etag: string | null;
  try {
    const res = await d.fetch(`${base}datapack/manifest.json`, { timeoutMs: MANIFEST_TIMEOUT_MS, etag: d.etag });
    if (res.status === 304) return { kind: "not-modified" };
    if (res.status !== 200) return { kind: "offline", problem: `Update feed answered HTTP ${res.status}` };
    etag = res.etag;
    manifestText = await res.text();
    const sig = await d.fetch(`${base}datapack/manifest.json.sig`, { timeoutMs: MANIFEST_TIMEOUT_MS });
    if (sig.status !== 200) return { kind: "offline", problem: `Signature download failed (HTTP ${sig.status})` };
    signature = (await sig.text()).trim();
  } catch (err) {
    return { kind: "offline", problem: err instanceof Error ? err.message : String(err) };
  }
  // Step 2 — nothing else is downloaded before this passes.
  const verified = await d.platform.packVerifyManifest(manifestText, signature).catch((e: unknown) => ({ ok: false, error: String(e) }));
  if (!verified.ok) return { kind: "rejected", problem: `Signature check failed${"error" in verified && verified.error ? `: ${verified.error}` : ""}`, etag };
  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestText) as Manifest;
  } catch {
    return { kind: "rejected", problem: "Manifest isn't JSON", etag };
  }
  // Step 3
  const activeVersion = d.activeManifest?.packVersion ?? "0000.00.00-0";
  if (comparePackVersions(manifest.packVersion, activeVersion) <= 0) return { kind: "up-to-date", feedVersion: manifest.packVersion, etag };
  // Step 4
  if (compareAppVersions(manifest.minAppVersion, d.appVersion) > 0)
    return { kind: "app-update-needed", feedVersion: manifest.packVersion, minAppVersion: manifest.minAppVersion, etag };
  // Step 5 — download changed files only.
  const activeHashes = new Map((d.activeManifest?.files ?? []).map((f) => [f.path, f.sha256]));
  const changed: { path: string; bytes: Uint8Array }[] = [];
  const raw: Partial<Record<PackKey, unknown>> = {};
  const keyOf = new Map(PACK_KEYS.map((k) => [PACK_FILES[k], k]));
  try {
    for (const f of manifest.files) {
      const key = keyOf.get(f.path);
      if (activeHashes.get(f.path) === f.sha256) {
        if (key) raw[key] = await d.readActive(f.path);
        continue;
      }
      const res = await d.fetch(`${base}datapack/${f.path}`, { timeoutMs: 30_000 });
      if (res.status !== 200) return { kind: "offline", problem: `Couldn't download ${f.path} (HTTP ${res.status})`, etag };
      const bytes = await res.bytes();
      changed.push({ path: f.path, bytes });
      if (key) raw[key] = JSON.parse(decoder.decode(bytes));
    }
  } catch (err) {
    return { kind: "rejected", problem: `Download problem: ${err instanceof Error ? err.message : String(err)}`, etag };
  }
  // Step 6 — validate the full candidate in memory; nothing has touched disk yet.
  const parsed = parsePack(raw);
  if (!parsed.ok) return { kind: "rejected", problem: `New guide data failed checks: ${parsed.problems.slice(0, 2).join("; ")}`, etag };
  // Step 7 — Rust re-verifies, stages, hash-checks and swaps.
  try {
    try {
      await d.platform.packInstall(manifestText, signature, changed);
    } catch (err) {
      if (!String(err).includes("NEED_ALL_FILES")) throw err;
      const all = await Promise.all(
        manifest.files.map(async (f) => {
          const hit = changed.find((c) => c.path === f.path);
          if (hit) return hit;
          const res = await d.fetch(`${base}datapack/${f.path}`, { timeoutMs: 30_000 });
          if (res.status !== 200) throw new Error(`Couldn't download ${f.path}`);
          return { path: f.path, bytes: await res.bytes() };
        }),
      );
      await d.platform.packInstall(manifestText, signature, all);
    }
  } catch (err) {
    return { kind: "rejected", problem: `Install failed: ${err instanceof Error ? err.message : String(err)}`, etag };
  }
  return { kind: "installed", pack: parsed.pack, version: manifest.packVersion, etag };
}

/** Pack source for the installed pack (null when none is installed). */
export async function installedSource(platform: Platform): Promise<PackSource | null> {
  const active = await platform.packActive().catch(() => null);
  if (!active?.version) return null;
  return { kind: "installed", read: async (file) => JSON.parse(await platform.packRead(file)) };
}

/**
 * Launch load (§8.6 step 10): the installed pack first; if it fails to load, roll back (Rust deletes it and
 * points at the previous one) and retry; finally the bundled baseline.
 */
export async function loadActivePack(platform: Platform, bundled: PackSource = bundledSource()): Promise<LoadResult> {
  const failures: { from: "installed" | "bundled"; problem: string }[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const installed = await installedSource(platform);
    if (!installed) break;
    const r = await loadPack([installed]);
    if (r.ok) return failures.length ? { ...r, fellBack: failures[0]! } : r;
    failures.push({ from: "installed", problem: r.problems.join("; ") });
    await platform.packRollback().catch(() => undefined);
  }
  const b = await loadPack([bundled]);
  return b.ok && failures.length ? { ...b, fellBack: failures[0]! } : b;
}

export type AppRelease = { version: string; notes: string; url: string; sha256: string; signature: string };

/** P8-T6: newer app version on the feed? (The exe's own signature is checked by Rust before it is swapped in.) */
export async function checkForAppUpdate(fetchFn: FeedFetch, appVersion: string, base = FEED_BASE): Promise<AppRelease | null> {
  try {
    const res = await fetchFn(`${base}releases/latest.json`, { timeoutMs: MANIFEST_TIMEOUT_MS });
    if (res.status !== 200) return null;
    const r = JSON.parse(await res.text()) as AppRelease;
    if (typeof r.version !== "string" || typeof r.url !== "string" || typeof r.sha256 !== "string" || typeof r.signature !== "string") return null;
    return compareAppVersions(r.version, appVersion) > 0 ? r : null;
  } catch {
    return null;
  }
}

export const manifestOf = async (read: (file: string) => Promise<unknown>): Promise<Manifest | null> => {
  try {
    return (await read("manifest.json")) as Manifest;
  } catch {
    return null;
  }
};

export { PACK_KEYS };
