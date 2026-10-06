import { base64ToBytes, bytesToBase64 } from "./base64";
import { encodePng } from "./png";
import { APP_EVENTS, NEED_ALL_FILES, RELEASE_URL_PREFIX } from "./types";
import type {
  BackupInfo,
  NotifyBanner,
  OcrLine,
  PackActive,
  Platform,
  ScreenRegion,
  ScreenSnapshot,
  ScreenWindow,
} from "./types";

const PACK_FILE = /^[a-z0-9.-]+\.json$/;
const CACHE_KEY = /^[a-z0-9-]{1,64}$/;
const PACK_VERSION = /^(\d{4})\.(\d{2})\.(\d{2})-(0|[1-9]\d{0,5})$/;
const KEEP_PREVIOUS_PACKS = 2;

type ManifestEntry = { path: string; sha256: string; bytes: number };

const isPackFile = (name: string) =>
  PACK_FILE.test(name) && !name.includes("..") && !name.startsWith(".");
/** `YYYY.MM.DD-n` → `[YYYY, MM, DD, n]`, like Rust `parse_version`. */
const versionTuple = (v: string): number[] | null => {
  const m = PACK_VERSION.exec(v);
  if (!m) return null;
  const [y, mo, d, n] = m.slice(1).map(Number) as [number, number, number, number];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? [y, mo, d, n] : null;
};
const compareVersions = (a: string, b: string) => {
  const [x, y] = [versionTuple(a) ?? [], versionTuple(b) ?? []];
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** SHA-256 hex via Web Crypto; `null` where it isn't available (the mock then checks sizes only). */
async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function matchesEntry(bytes: Uint8Array, f: ManifestEntry): Promise<boolean> {
  if (bytes.byteLength !== f.bytes) return false;
  const hash = await sha256Hex(bytes);
  return hash === null || hash === f.sha256.toLowerCase();
}

/** Same shape rules as Rust `parse_manifest`; throws on the first problem. */
function parseManifest(json: string): { packVersion: string; files: ManifestEntry[] } {
  const m = JSON.parse(json) as { schema?: unknown; packVersion?: unknown; files?: unknown };
  if (m.schema !== 1) throw new Error(`Unsupported manifest schema ${String(m.schema)}`);
  if (typeof m.packVersion !== "string" || !versionTuple(m.packVersion))
    throw new Error("Bad packVersion");
  if (!Array.isArray(m.files) || m.files.length === 0) throw new Error("Manifest lists no files");
  const seen = new Set<string>();
  for (const f of m.files as ManifestEntry[]) {
    if (!isPackFile(f.path) || f.path === "manifest.json")
      throw new Error(`Rejected file path "${f.path}" in the manifest`);
    if (seen.has(f.path)) throw new Error(`${f.path} is listed twice in the manifest`);
    if (!/^[0-9a-fA-F]{64}$/.test(f.sha256)) throw new Error(`Bad sha256 for ${f.path}`);
    seen.add(f.path);
  }
  return { packVersion: m.packVersion, files: m.files as ManifestEntry[] };
}

/** Same limits as Rust `screen.rs`. */
const MAX_REGION_SIDE = 4000;
const MAX_REGIONS = 16;
const ACTION_KIND = /^[a-z0-9][a-z0-9:._-]{0,63}$/;
/** The fake game window `screenListWindows` returns by default. */
export const MOCK_GAME_WINDOW: ScreenWindow = {
  id: 4242,
  title: "MapleStory",
  app: "MapleStory.exe",
  width: 1280,
  height: 720,
  minimized: false,
};

/** Same checks as Rust `check_regions`; returns rounded rects or throws the Rust-style message. */
function checkRegions(regions: ScreenRegion[], win: ScreenWindow) {
  if (regions.length > MAX_REGIONS) throw new Error(`At most ${MAX_REGIONS} regions per read`);
  const names = new Set<string>();
  return regions.map((r) => {
    if (names.has(r.name)) throw new Error(`Region name "${r.name}" is used twice`);
    names.add(r.name);
    if (r.name.trim() === "" || [...r.name].length > 64)
      throw new Error("Region name must be 1-64 characters");
    if ([r.x, r.y, r.w, r.h].some((v) => !Number.isFinite(v) || v < 0))
      throw new Error(`Region "${r.name}" has a negative or invalid coordinate`);
    const [x, y, w, h] = [r.x, r.y, r.w, r.h].map(Math.round) as [number, number, number, number];
    if (w < 1 || h < 1) throw new Error(`Region "${r.name}" is empty`);
    if (w > MAX_REGION_SIDE || h > MAX_REGION_SIDE)
      throw new Error(`Region "${r.name}" is larger than ${MAX_REGION_SIDE}x${MAX_REGION_SIDE}`);
    if (x + w > win.width || y + h > win.height)
      throw new Error(`Region "${r.name}" (${x},${y} ${w}x${h}) is outside the ${win.width}x${win.height} window`);
    const scale = r.scale ?? 2;
    if (!Number.isFinite(scale) || scale < 1 || scale > 4) throw new Error("scale must be between 1 and 4");
    return { name: r.name, w, h, mode: r.mode ?? "ocr" };
  });
}

/** A recognisable fake game screen: sky, ground, a chat box (bottom left) and a yellow EXP bar (bottom). */
function fakeGameScreen(width: number, height: number): Uint8Array {
  return encodePng(width, height, (x, y) => {
    const fy = y / height;
    if (fy > 0.95) return x / width < 0.42 ? [240, 200, 40] : [70, 60, 30]; // EXP bar, 42% full
    if (fy > 0.72 && x / width < 0.4) return [25, 25, 35]; // chat log
    if (fy > 0.62) return [90, 140, 70]; // ground
    return [120, 170, 230]; // sky
  });
}

const textLine = (text: string, i: number, w: number, h: number): OcrLine => ({
  text,
  x: 0,
  y: Math.min(i * 14, Math.max(0, h - 12)),
  w: Math.min(w, text.length * 7),
  h: Math.min(12, h),
});

/** Knobs and state UI tests can read or change. */
export type MockControls = {
  /** `false` → `packVerifyManifest` / `packInstall` treat every signature as bad. */
  signatureOk: boolean;
  appVersion: string;
  /** Active installed pack version (`null` → bundled baseline). */
  activePack: string | null;
  /** What `screenListWindows` returns (default: one 1280x720 "MapleStory" window). */
  windows: ScreenWindow[];
  /** Region name → lines `screenRead` returns (strings get simple stacked boxes). Missing → no lines. */
  ocrLines: Record<string, (string | OcrLine)[]>;
  /** `covered` flag on every region `screenRead` returns. */
  covered: boolean;
  hotkeyRegistered: boolean;
  hotkey: string;
  /** What a `mode: "bar"` region reports. */
  barFill: number | null;
  /** `true` → `notify` reports a Windows toast; `false` (like the portable exe) → banner event fallback. */
  toast: boolean;
  miniOpen: boolean;
  /** Emits an app event to every `onEvent` subscriber (e.g. `"mcc://watch-toggle"`). */
  emit: (name: string, payload?: unknown) => void;
};

/** In-memory Platform for the browser, Vitest and Playwright. Mirrors the Rust checks that matter to the UI. */
export function createMockPlatform(initialJson: string | null = null): Platform & {
  saves: string[];
  opened: string[];
  exports: Map<string, string>;
  notes: Map<string, { json: string; images: Uint8Array[] }>;
  /** Installed packs: version → file name → bytes (incl. `manifest.json`). */
  packs: Map<string, Map<string, Uint8Array>>;
  cache: Map<string, string>;
  updateCalls: { url: string; sha256: string; signature: string }[];
  /** Notifications shown as (mock) toasts. */
  toasts: NotifyBanner[];
  /** `relayToMain` calls, in order. */
  relayed: { kind: string; payload: unknown }[];
  controls: MockControls;
} {
  let current = initialJson;
  const backups: (BackupInfo & { json: string })[] = [];
  const images = new Map<string, Uint8Array>();
  const saves: string[] = [];
  const opened: string[] = [];
  const exports = new Map<string, string>();
  const notes = new Map<string, { json: string; images: Uint8Array[] }>();
  const packs = new Map<string, Map<string, Uint8Array>>();
  const cache = new Map<string, string>();
  const updateCalls: { url: string; sha256: string; signature: string }[] = [];
  const toasts: NotifyBanner[] = [];
  const relayed: { kind: string; payload: unknown }[] = [];
  const watchLog: string[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const emit = (name: string, payload: unknown = null) => {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(payload);
  };
  const controls: MockControls = {
    signatureOk: true,
    appVersion: "0.1.0",
    activePack: null,
    windows: [{ ...MOCK_GAME_WINDOW }],
    ocrLines: {},
    covered: false,
    hotkeyRegistered: true,
    hotkey: "Ctrl+Shift+K",
    barFill: null,
    toast: false,
    miniOpen: false,
    emit,
  };

  const findWindow = (id: number) => {
    const w = controls.windows.find((x) => x.id === id);
    if (!w) throw new Error("That window has closed — pick it again");
    if (w.minimized) throw new Error("The window is minimised — restore it first");
    return w;
  };
  const checkNote = (title: string, body: string) => {
    if (title.trim() === "" || [...title].length > 200)
      throw new Error("Notification title must be 1-200 characters");
    if ([...body].length > 1000) throw new Error("Notification text is too long (max 1000 characters)");
  };

  const checkImage = (bytes: Uint8Array) => {
    if (bytes.byteLength > 400 * 1024) throw new Error("Image is too large (max 400 KB)");
  };

  const activePack = (): PackActive => {
    const v = controls.activePack;
    return v && packs.has(v)
      ? { version: v, dir: `(in-memory)/packs/${v}` }
      : { version: null, dir: null };
  };

  const verifyManifest = (manifestJson: string, signature: string) => {
    if (!controls.signatureOk || signature.trim() === "")
      throw new Error("Manifest signature rejected: Signature does not match");
    return parseManifest(manifestJson);
  };

  const checkCacheKey = (key: string) => {
    if (!CACHE_KEY.test(key)) throw new Error("key must match ^[a-z0-9-]{1,64}$");
  };

  return {
    kind: "mock",
    saves,
    opened,
    exports,
    notes,
    packs,
    cache,
    updateCalls,
    toasts,
    relayed,
    controls,
    getPaths: async () => ({ dataDir: "(in-memory)", portable: false }),
    profilesLoad: async () => ({ json: current, restoredFromBackup: null, corruptFile: null }),
    profilesSave: async (json) => {
      JSON.parse(json); // refuse invalid JSON like Rust does
      if (current !== null && backups.length === 0) {
        backups.unshift({
          file: "profiles-mock.json",
          savedAt: new Date().toISOString(),
          json: current,
        });
      }
      current = json;
      saves.push(json);
      emit(APP_EVENTS.profilesSaved, null);
    },
    backupsList: async () => backups.map(({ file, savedAt }) => ({ file, savedAt })),
    backupsRestore: async (file) => {
      const b = backups.find((x) => x.file === file);
      if (!b) throw new Error("Not a backup file name");
      return b.json;
    },
    backupNow: async () => {
      if (current !== null) {
        backups.unshift({
          file: `profiles-mock-${backups.length}.json`,
          savedAt: new Date().toISOString(),
          json: current,
        });
      }
    },
    exportSave: async (fileName, json) => {
      JSON.parse(json);
      exports.set(fileName, json);
      return `(in-memory)/exports/${fileName}`;
    },
    revealFolder: async () => {},
    fieldNoteCreate: async (json) => {
      JSON.parse(json);
      const id = `note-${notes.size + 1}`;
      notes.set(id, { json, images: [] });
      return id;
    },
    fieldNoteAddImage: async (noteId, bytes) => {
      checkImage(bytes);
      const note = notes.get(noteId);
      if (!note) throw new Error("Note not found");
      note.images.push(bytes);
      return { file: `img-${note.images.length}.webp` };
    },
    screenshotSave: async (profileId, bytes) => {
      checkImage(bytes);
      images.set(`shot:${profileId}`, bytes);
      return { file: `${profileId}.webp` };
    },
    screenshotRead: async (profileId) => images.get(`shot:${profileId}`) ?? null,
    screenshotDelete: async (profileId) => void images.delete(`shot:${profileId}`),
    entityImageSave: async (kind, id, bytes) => {
      checkImage(bytes);
      images.set(`${kind}:${id}`, bytes);
      return { file: `${id}.webp` };
    },
    entityImageRead: async (kind, id) => images.get(`${kind}:${id}`) ?? null,
    entityImageDelete: async (kind, id) => void images.delete(`${kind}:${id}`),
    imageCacheSave: async (kind, id, bytes) => {
      checkImage(bytes);
      images.set(`cache:${kind}:${id}`, bytes);
      return { file: `${id}.webp` };
    },
    imageCacheRead: async (kind, id) => images.get(`cache:${kind}:${id}`) ?? null,
    openUrl: async (url) => {
      opened.push(url);
    },
    packActive: async () => {
      if (controls.activePack && !packs.has(controls.activePack)) controls.activePack = null;
      return activePack();
    },
    packRead: async (file) => {
      if (!isPackFile(file)) throw new Error("file must match ^[a-z0-9.-]+\\.json$");
      const { version } = activePack();
      if (!version) throw new Error("No installed pack is active");
      const bytes = packs.get(version)?.get(file);
      if (!bytes) throw new Error(`Can't read ${file}`);
      return new TextDecoder().decode(bytes);
    },
    packVerifyManifest: async (manifestJson, signature) => {
      try {
        verifyManifest(manifestJson, signature);
        return { ok: true, error: null };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    packInstall: async (manifestJson, signature, files) => {
      const manifest = verifyManifest(manifestJson, signature);
      const listed = new Set(manifest.files.map((f) => f.path));
      const incoming = new Map<string, Uint8Array>();
      for (const f of files) {
        if (!isPackFile(f.path)) throw new Error(`Rejected file path "${f.path}"`);
        if (!listed.has(f.path)) throw new Error(`${f.path} is not in the manifest`);
        if (incoming.has(f.path)) throw new Error(`${f.path} was sent twice`);
        incoming.set(
          f.path,
          typeof f.bytes === "string" ? base64ToBytes(f.bytes) : new Uint8Array(f.bytes),
        );
      }
      const active = activePack().version;
      const staged = new Map<string, Uint8Array>();
      for (const f of manifest.files) {
        let bytes = incoming.get(f.path);
        if (!bytes) {
          const fromActive = active ? packs.get(active)?.get(f.path) : undefined;
          if (!fromActive || !(await matchesEntry(fromActive, f))) {
            throw new Error(
              `${NEED_ALL_FILES}: ${f.path} is not in the active installed pack; send every file`,
            );
          }
          bytes = fromActive;
        }
        staged.set(f.path, bytes);
      }
      for (const f of manifest.files) {
        if (!(await matchesEntry(staged.get(f.path)!, f))) {
          throw new Error(
            `${f.path} does not match the manifest (sha256 or size); install cancelled`,
          );
        }
      }
      staged.set("manifest.json", new TextEncoder().encode(manifestJson));
      const version = manifest.packVersion;
      packs.set(version, staged);
      controls.activePack = version;
      const others = [...packs.keys()]
        .filter((v) => v !== version)
        .sort((a, b) => compareVersions(b, a));
      for (const old of others.slice(KEEP_PREVIOUS_PACKS)) packs.delete(old);
      return { version };
    },
    packRollback: async () => {
      const failed = controls.activePack;
      if (!failed) return activePack();
      packs.delete(failed);
      const previous = [...packs.keys()]
        .filter((v) => compareVersions(v, failed) < 0)
        .sort((a, b) => compareVersions(b, a))[0];
      controls.activePack = previous ?? null;
      return activePack();
    },
    appUpdateApply: async (url, sha256, signature) => {
      const rest = url.startsWith(RELEASE_URL_PREFIX)
        ? url.slice(RELEASE_URL_PREFIX.length).split("/")
        : [];
      if (
        rest.length !== 2 ||
        !rest.every((s) => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(s) && !s.includes(".."))
      ) {
        throw new Error("Update URL is not an official release download");
      }
      updateCalls.push({ url, sha256, signature });
    },
    appVersion: async () => controls.appVersion,
    cacheRead: async (key) => {
      checkCacheKey(key);
      return cache.get(key) ?? null;
    },
    cacheWrite: async (key, json) => {
      checkCacheKey(key);
      JSON.parse(json); // refuse invalid JSON like Rust does
      cache.set(key, json);
    },
    screenListWindows: async () => controls.windows.map((w) => ({ ...w })),
    screenSnapshot: async (windowId): Promise<ScreenSnapshot> => {
      const w = findWindow(windowId);
      // Smaller than the real long-edge-1600 picture to keep the mock light; the contract only needs
      // width/height = PNG size and sourceWidth/sourceHeight = window size.
      const k = Math.max(1, Math.ceil(Math.max(w.width, w.height) / 160));
      const [width, height] = [Math.max(1, Math.round(w.width / k)), Math.max(1, Math.round(w.height / k))];
      return {
        pngBase64: bytesToBase64(fakeGameScreen(width, height)),
        width,
        height,
        sourceWidth: w.width,
        sourceHeight: w.height,
        covered: controls.covered,
      };
    },
    screenRead: async (windowId, regions) => {
      const w = findWindow(windowId);
      return checkRegions(regions, w).map((r) => ({
        name: r.name,
        lines: r.mode === "bar" ? [] : (controls.ocrLines[r.name] ?? []).map((l, i) => (typeof l === "string" ? textLine(l, i, r.w, r.h) : { ...l })),
        covered: controls.covered,
        ...(r.mode === "bar" || r.mode === "both" ? { fill: controls.barFill } : {}),
        ...(r.mode === "both" ? { digits: (controls.ocrLines[r.name] ?? []).map((l) => (typeof l === "string" ? l : l.text)).join(" ").replace(/[.,]/g, "") } : {}),
      }));
    },
    hotkeyStatus: async () => ({ registered: controls.hotkeyRegistered, accelerator: controls.hotkey }),
    hotkeySet: async (accelerator) => {
      const parts = accelerator.split("+").map((p) => p.trim());
      const key = parts.at(-1) ?? "";
      if (parts.length < 2 || !/^([A-Za-z]|\d|F\d{1,2})$/.test(key) || !parts.slice(0, -1).every((m) => /^(ctrl|control|alt|shift)$/i.test(m)))
        throw new Error("Use at least one of Ctrl, Alt, Shift plus a key, e.g. Ctrl+Shift+K");
      controls.hotkey = accelerator;
      return { registered: controls.hotkeyRegistered, accelerator };
    },
    watchLogAppend: async (line) => {
      JSON.parse(line);
      watchLog.push(line);
      return "mock.jsonl";
    },
    watchLogClear: async () => {
      const n = watchLog.length;
      watchLog.length = 0;
      return n;
    },
    notify: async (title, body) => {
      checkNote(title, body);
      if (controls.toast) {
        toasts.push({ title, body });
        return { via: "toast", reason: null };
      }
      emit(APP_EVENTS.notifyBanner, { title, body });
      return { via: "fallback", reason: "Windows only shows pop-up notifications for installed apps" };
    },
    notifyStatus: async () =>
      controls.toast
        ? { toast: true, reason: null }
        : { toast: false, reason: "Windows only shows pop-up notifications for installed apps" },
    miniWindowOpen: async () => {
      controls.miniOpen = true;
    },
    miniWindowClose: async () => {
      controls.miniOpen = false;
    },
    relayToMain: async (kind, payload) => {
      if (!ACTION_KIND.test(kind)) throw new Error("kind must match ^[a-z0-9][a-z0-9:._-]{0,63}$");
      const action = { kind, payload: payload ?? null };
      relayed.push(action);
      emit(APP_EVENTS.miniAction, action);
    },
    onEvent: (name: string, handler: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      const entry = (payload: unknown) => handler(payload); // one entry per subscription
      set.add(entry);
      return () => void set.delete(entry);
    },
  };
}
