import { base64ToBytes, bytesToBase64 } from "./base64";
import { createMockPlatform } from "./ipc.mock";
import { NEED_ALL_FILES, RELEASE_URL_PREFIX } from "./types";

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
