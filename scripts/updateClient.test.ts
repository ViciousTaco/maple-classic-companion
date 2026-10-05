// @vitest-environment node
import { createHash } from "node:crypto";
import { createMockPlatform } from "../src/platform/ipc.mock";
import { miniPack } from "../src/data/fixtures/miniPack";
import { PACK_FILES, type PackData, type PackKey } from "../src/data/schema/pack";
import {
  checkForAppUpdate,
  checkForPackUpdate,
  compareAppVersions,
  comparePackVersions,
  loadActivePack,
  type FeedFetch,
  type Manifest,
} from "../src/data/updateClient";
import type { PackSource } from "../src/data/pack";

const enc = new TextEncoder();
const BASE = "https://feed.test/";

function build(p: PackData, version: string, minAppVersion = "0.1.0") {
  const files: Record<string, string> = {};
  const entries = (Object.keys(PACK_FILES) as PackKey[]).map((k) => {
    const body = JSON.stringify(p[k]);
    files[PACK_FILES[k]] = body;
    return { path: PACK_FILES[k], sha256: createHash("sha256").update(body).digest("hex"), bytes: enc.encode(body).byteLength };
  });
  const manifest: Manifest = { schema: 1, packVersion: version, builtAt: "2026-10-07T00:00:00Z", minAppVersion, gameLabel: "x", reviewedThroughArticleId: 1, files: entries };
  return { files, manifest, manifestText: JSON.stringify(manifest) };
}

/** A fake GitHub Pages feed that records every URL requested. */
function feed(b: ReturnType<typeof build> | null, opts: { status?: number; throws?: boolean } = {}) {
  const calls: string[] = [];
  const fetchFn: FeedFetch = async (url, o) => {
    calls.push(url);
    if (opts.throws) throw new Error("network down");
    if (opts.status) return { status: opts.status, etag: null, text: async () => "", bytes: async () => new Uint8Array() };
    if (o.etag === '"same"') return { status: 304, etag: '"same"', text: async () => "", bytes: async () => new Uint8Array() };
    const path = url.slice(BASE.length);
    const body = path === "datapack/manifest.json" ? b!.manifestText : path === "datapack/manifest.json.sig" ? "c2lnbmF0dXJl" : path.startsWith("datapack/") ? b!.files[path.slice(9)] : undefined;
    if (body === undefined) return { status: 404, etag: null, text: async () => "", bytes: async () => new Uint8Array() };
    return { status: 200, etag: '"v"', text: async () => body, bytes: async () => enc.encode(body) };
  };
  return { fetchFn, calls };
}

const bundled = build(miniPack(), "2026.10.05-1");
const readBundled = async (file: string) => JSON.parse(bundled.files[file]!);

function deps(platform = createMockPlatform(), f = feed(build(miniPack(), "2026.10.07-1"))) {
  return {
    platform,
    calls: f.calls,
    d: { platform, fetch: f.fetchFn, appVersion: "0.1.0", activeManifest: bundled.manifest, activeFrom: "bundled" as const, readActive: readBundled, base: BASE },
  };
}

test("version comparisons", () => {
  expect(comparePackVersions("2026.10.07-1", "2026.10.05-3")).toBeGreaterThan(0);
  expect(comparePackVersions("2026.10.07-2", "2026.10.07-10")).toBeLessThan(0);
  expect(compareAppVersions("1.0.0", "0.9.12")).toBeGreaterThan(0);
  expect(compareAppVersions("0.1.0", "0.1.0")).toBe(0);
});

test("offline → keep current", async () => {
  const { d } = deps(createMockPlatform(), feed(null, { throws: true }));
  expect(await checkForPackUpdate(d)).toMatchObject({ kind: "offline", problem: "network down" });
});

test("304 Not Modified → keep current", async () => {
  const { d } = deps();
  expect(await checkForPackUpdate({ ...d, etag: '"same"' })).toEqual({ kind: "not-modified" });
});

test("a bad signature stops everything before any pack file is downloaded", async () => {
  const platform = createMockPlatform();
  platform.controls.signatureOk = false;
  const { d, calls } = deps(platform);
  expect((await checkForPackUpdate(d)).kind).toBe("rejected");
  expect(calls).toEqual([`${BASE}datapack/manifest.json`, `${BASE}datapack/manifest.json.sig`]);
  expect(platform.packs.size).toBe(0);
});

test("same or older version → up to date", async () => {
  const { d } = deps(createMockPlatform(), feed(build(miniPack(), "2026.10.05-1")));
  expect(await checkForPackUpdate(d)).toMatchObject({ kind: "up-to-date" });
});

test("minAppVersion newer than the app → app update needed, nothing installed", async () => {
  const platform = createMockPlatform();
  const { d } = deps(platform, feed(build(miniPack(), "2026.10.07-1", "9.0.0")));
  expect(await checkForPackUpdate(d)).toMatchObject({ kind: "app-update-needed", minAppVersion: "9.0.0" });
  expect(platform.packs.size).toBe(0);
});

test("happy path: downloads only changed files, sends all when the bundle is active (NEED_ALL_FILES), installs", async () => {
  const next = miniPack();
  next.meta.packVersion = "2026.10.07-1";
  next.monsters[0]!.hp = 111;
  const platform = createMockPlatform();
  const { d, calls } = deps(platform, feed(build(next, "2026.10.07-1")));
  const r = await checkForPackUpdate(d);
  expect(r.kind).toBe("installed");
  if (r.kind === "installed") expect(r.pack.index.monsterById.get("mob-a")?.hp).toBe(111);
  const firstPass = calls.filter((c) => c.endsWith("monsters.json") || c.endsWith("meta.json"));
  expect(firstPass.length).toBeGreaterThanOrEqual(2);
  expect(calls.filter((c) => c.endsWith("jobs.json")).length).toBe(1); // unchanged → fetched only for the full resend
  expect(platform.controls.activePack).toBe("2026.10.07-1");
});

test("an invalid candidate pack is rejected before anything is installed", async () => {
  const bad = miniPack();
  bad.meta.packVersion = "2026.10.07-1";
  bad.maps[1]!.spawns.push({ mobId: "ghost", count: 1 });
  const platform = createMockPlatform();
  const { d } = deps(platform, feed(build(bad, "2026.10.07-1")));
  const r = await checkForPackUpdate(d);
  expect(r).toMatchObject({ kind: "rejected" });
  expect(r.kind === "rejected" && r.problem).toMatch(/unknown monster "ghost"/);
  expect(platform.packs.size).toBe(0);
});

test("launch load: a broken installed pack is rolled back and the bundle used", async () => {
  const platform = createMockPlatform();
  const v1 = build({ ...miniPack(), meta: { ...miniPack().meta, packVersion: "2026.10.06-1" } }, "2026.10.06-1");
  platform.packs.set("2026.10.06-1", new Map(Object.entries({ ...v1.files, "monsters.json": "[{}]", "manifest.json": v1.manifestText }).map(([k, v]) => [k, enc.encode(v)])));
  platform.controls.activePack = "2026.10.06-1";
  const bundledSrc: PackSource = { kind: "bundled", read: readBundled };
  const r = await loadActivePack(platform, bundledSrc);
  expect(r.ok && r.from).toBe("bundled");
  expect(r.ok && r.fellBack?.from).toBe("installed");
  expect(platform.controls.activePack).toBeNull();
});

test("app update check", async () => {
  const release = { version: "1.0.0", notes: "x", url: "https://github.com/ViciousTaco/maple-classic-companion/releases/download/v1.0.0/MapleClassicCompanion.exe", sha256: "a".repeat(64), signature: "c2ln" };
  const f: FeedFetch = async () => ({ status: 200, etag: null, text: async () => JSON.stringify(release), bytes: async () => new Uint8Array() });
  expect(await checkForAppUpdate(f, "0.9.0", BASE)).toEqual(release);
  expect(await checkForAppUpdate(f, "1.0.0", BASE)).toBeNull();
  expect(await checkForAppUpdate(async () => { throw new Error("x"); }, "0.9.0", BASE)).toBeNull();
});
