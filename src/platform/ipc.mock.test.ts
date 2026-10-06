import { base64ToBytes, bytesToBase64 } from "./base64";
import { createMockPlatform, MOCK_GAME_WINDOW } from "./ipc.mock";
import { APP_EVENTS, NEED_ALL_FILES, RELEASE_URL_PREFIX } from "./types";

test("mock round-trips profiles and refuses invalid JSON", async () => {
  const p = createMockPlatform();
  await p.profilesSave('{"a":1}');
  expect((await p.profilesLoad()).json).toBe('{"a":1}');
  await expect(p.profilesSave("{bad")).rejects.toThrow();
  expect((await p.profilesLoad()).json).toBe('{"a":1}');
});

test("mock stores and deletes screenshots, rejecting oversize images", async () => {
  const p = createMockPlatform();
  const id = "0b9f8a52-6a4e-4a39-9c55-2f1d1f7f0a11";
  expect(await p.screenshotRead(id)).toBeNull();
  await p.screenshotSave(id, new Uint8Array([1, 2, 3]));
  expect(await p.screenshotRead(id)).toEqual(new Uint8Array([1, 2, 3]));
  await expect(p.screenshotSave(id, new Uint8Array(400 * 1024 + 1))).rejects.toThrow();
  await p.screenshotDelete(id);
  expect(await p.screenshotRead(id)).toBeNull();
});

// ---- Live updates (P8) ----

const enc = (s: string) => new TextEncoder().encode(s);
const sha = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc(s))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const manifest = async (packVersion: string, files: Record<string, string>) =>
  JSON.stringify({
    schema: 1,
    packVersion,
    files: await Promise.all(
      Object.entries(files).map(async ([path, data]) => ({
        path,
        sha256: await sha(data),
        bytes: enc(data).byteLength,
      })),
    ),
  });

test("base64 helpers round-trip binary data", () => {
  const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
  expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  expect(bytesToBase64(enc('{"a":1}'))).toBe("eyJhIjoxfQ==");
});

test("mock pack install: full, partial update, NEED_ALL_FILES, rollback", async () => {
  const p = createMockPlatform();
  expect(await p.packActive()).toEqual({ version: null, dir: null });
  const v1 = await manifest("2026.10.07-1", { "a.json": '{"a":1}', "b.json": '{"b":1}' });
  const v2 = await manifest("2026.10.08-1", { "a.json": '{"a":2}', "b.json": '{"b":1}' });
  expect(await p.packVerifyManifest(v1, "sig")).toEqual({ ok: true, error: null });

  // Partial install with nothing installed → resend everything.
  await expect(
    p.packInstall(v2, "sig", [{ path: "a.json", bytes: enc('{"a":2}') }]),
  ).rejects.toThrow(NEED_ALL_FILES);
  await p.packInstall(v1, "sig", [
    { path: "a.json", bytes: enc('{"a":1}') },
    { path: "b.json", bytes: bytesToBase64(enc('{"b":1}')) },
  ]);
  expect((await p.packActive()).version).toBe("2026.10.07-1");
  expect(await p.packRead("manifest.json")).toBe(v1);

  expect(await p.packInstall(v2, "sig", [{ path: "a.json", bytes: enc('{"a":2}') }])).toEqual({
    version: "2026.10.08-1",
  });
  expect(await p.packRead("a.json")).toBe('{"a":2}');
  expect(await p.packRead("b.json")).toBe('{"b":1}');

  expect((await p.packRollback()).version).toBe("2026.10.07-1");
  expect(await p.packRead("a.json")).toBe('{"a":1}');
  expect(await p.packRollback()).toEqual({ version: null, dir: null });
  await expect(p.packRead("a.json")).rejects.toThrow();
});

test("mock pack install rejects bad signatures, paths and hashes", async () => {
  const p = createMockPlatform();
  const v1 = await manifest("2026.10.07-1", { "a.json": '{"a":1}' });
  await expect(
    p.packInstall(v1, "sig", [{ path: "../a.json", bytes: enc('{"a":1}') }]),
  ).rejects.toThrow("Rejected");
  await expect(
    p.packInstall(v1, "sig", [{ path: "a.json", bytes: enc('{"a":9}') }]),
  ).rejects.toThrow("does not match");
  p.controls.signatureOk = false;
  expect((await p.packVerifyManifest(v1, "sig")).ok).toBe(false);
  await expect(
    p.packInstall(v1, "sig", [{ path: "a.json", bytes: enc('{"a":1}') }]),
  ).rejects.toThrow("signature");
  expect(await p.packActive()).toEqual({ version: null, dir: null });
});

test("mock keeps the active pack and two previous ones", async () => {
  const p = createMockPlatform();
  for (const day of ["01", "02", "03", "04", "05"]) {
    const m = await manifest(`2026.10.${day}-1`, { "a.json": day });
    await p.packInstall(m, "sig", [{ path: "a.json", bytes: enc(day) }]);
  }
  expect([...p.packs.keys()].sort()).toEqual(["2026.10.03-1", "2026.10.04-1", "2026.10.05-1"]);
});

test("mock cache and app update", async () => {
  const p = createMockPlatform();
  expect(await p.cacheRead("news-index")).toBeNull();
  await p.cacheWrite("news-index", '{"items":[]}');
  expect(await p.cacheRead("news-index")).toBe('{"items":[]}');
  await expect(p.cacheWrite("news-index", "<html>")).rejects.toThrow();
  await expect(p.cacheRead("../x")).rejects.toThrow();

  expect(await p.appVersion()).toBe("0.1.0");
  const url = `${RELEASE_URL_PREFIX}v0.2.0/MapleClassicCompanion.exe`;
  await p.appUpdateApply(url, "ab".repeat(32), "sig");
  expect(p.updateCalls).toEqual([{ url, sha256: "ab".repeat(32), signature: "sig" }]);
  await expect(p.appUpdateApply("https://evil.example/x.exe", "", "")).rejects.toThrow();
  await expect(p.appUpdateApply(`${RELEASE_URL_PREFIX}../../x/y.exe`, "", "")).rejects.toThrow();
});

// ---- Screen watcher, hotkey, notifications, mini window ----

test("mock screen watcher: windows, snapshot PNG, region checks and OCR lines", async () => {
  const p = createMockPlatform();
  const [win] = await p.screenListWindows();
  expect(win).toEqual(MOCK_GAME_WINDOW);

  const shot = await p.screenSnapshot(win!.id);
  const png = base64ToBytes(shot.pngBase64);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset);
  expect([view.getUint32(16), view.getUint32(20)]).toEqual([shot.width, shot.height]);
  expect([shot.sourceWidth, shot.sourceHeight]).toEqual([1280, 720]);
  expect(shot.width).toBeLessThanOrEqual(1600);

  p.controls.ocrLines = { status: ["Lv. 23", "EXP 1234 [12.34%]"] };
  const out = await p.screenRead(win!.id, [
    { name: "status", x: 10, y: 690, w: 400, h: 30 },
    { name: "chat", x: 0, y: 520, w: 500.4, h: 150, scale: 3, filter: "nearest" },
  ]);
  expect(out.map((r) => [r.name, r.lines.map((l) => l.text), r.covered])).toEqual([
    ["status", ["Lv. 23", "EXP 1234 [12.34%]"], false],
    ["chat", [], false],
  ]);
  for (const l of out[0]!.lines) expect(l.y + l.h).toBeLessThanOrEqual(30);

  const read = (r: Partial<{ name: string; x: number; y: number; w: number; h: number; scale: number }>) =>
    p.screenRead(win!.id, [{ name: "r", x: 0, y: 0, w: 10, h: 10, ...r }]);
  await expect(read({ x: 1271 })).rejects.toThrow("outside");
  await expect(read({ w: 4001 })).rejects.toThrow();
  await expect(read({ x: -1 })).rejects.toThrow();
  await expect(read({ scale: 5 })).rejects.toThrow("scale");
  await expect(
    p.screenRead(win!.id, [
      { name: "a", x: 0, y: 0, w: 5, h: 5 },
      { name: "a", x: 0, y: 0, w: 5, h: 5 },
    ]),
  ).rejects.toThrow("twice");
  await expect(p.screenRead(999, [])).rejects.toThrow("closed");
  p.controls.windows[0]!.minimized = true;
  await expect(p.screenSnapshot(win!.id)).rejects.toThrow("minimised");
});

test("mock events: hotkey toggle, profiles-saved, mini relay, unsubscribe", async () => {
  const p = createMockPlatform();
  expect(await p.hotkeyStatus()).toEqual({ registered: true, accelerator: "Ctrl+Shift+K" });
  expect((await p.hotkeySet("Ctrl+Alt+W")).accelerator).toBe("Ctrl+Alt+W");
  await expect(p.hotkeySet("K")).rejects.toThrow(/at least one/);

  const seen: string[] = [];
  const offToggle = p.onEvent(APP_EVENTS.watchToggle, () => seen.push("toggle"));
  const offSaved = p.onEvent(APP_EVENTS.profilesSaved, () => seen.push("saved"));
  const offAction = p.onEvent(APP_EVENTS.miniAction, (a) => seen.push(`action:${a.kind}`));
  p.controls.emit("mcc://watch-toggle");
  await p.profilesSave('{"a":1}');
  await p.relayToMain("skip-spot", { profileId: "x", spotId: "y" });
  expect(p.relayed).toEqual([{ kind: "skip-spot", payload: { profileId: "x", spotId: "y" } }]);
  await expect(p.relayToMain("Bad Kind")).rejects.toThrow("kind");
  expect(seen).toEqual(["toggle", "saved", "action:skip-spot"]);

  offToggle();
  offSaved();
  offAction();
  offAction(); // safe twice
  p.controls.emit("mcc://watch-toggle");
  await p.profilesSave('{"a":2}');
  expect(seen).toHaveLength(3);

  await p.miniWindowOpen();
  expect(p.controls.miniOpen).toBe(true);
  await p.miniWindowClose();
  expect(p.controls.miniOpen).toBe(false);
});

test("mock notify: banner fallback like the portable exe, or a toast", async () => {
  const p = createMockPlatform();
  const banners: unknown[] = [];
  p.onEvent(APP_EVENTS.notifyBanner, (b) => banners.push(b));
  expect((await p.notifyStatus()).toast).toBe(false);
  expect((await p.notify("Gold Rush in 15 min", "Starts 8:00 pm")).via).toBe("fallback");
  expect(banners).toEqual([{ title: "Gold Rush in 15 min", body: "Starts 8:00 pm" }]);
  await expect(p.notify(" ", "")).rejects.toThrow();

  p.controls.toast = true;
  expect(await p.notify("Boss", "now")).toEqual({ via: "toast", reason: null });
  expect(p.toasts).toEqual([{ title: "Boss", body: "now" }]);
  expect(banners).toHaveLength(1);
});
