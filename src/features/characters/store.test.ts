import { createMockPlatform } from "../../platform/ipc.mock";
import { activeProfile, createProfileStore } from "./store";

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const base = { name: "Tester", jobId: "thief" as const, level: 23 };

beforeEach(() => {
  vi.useFakeTimers();
  n = 0;
});
afterEach(() => vi.useRealTimers());

async function ready(initial: string | null = null) {
  const platform = createMockPlatform(initial);
  const store = createProfileStore(platform, { newId });
  await store.getState().load();
  return { platform, store };
}

test("10 rapid edits produce 1 save", async () => {
  const { platform, store } = await ready();
  const p = store.getState().createProfile(base);
  for (let i = 0; i < 10; i++) {
    store.getState().updateProfile(p.id, (x) => ({ ...x, level: 24 + i }));
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(platform.saves).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(400);
  expect(platform.saves).toHaveLength(1);
  expect(JSON.parse(platform.saves[0]!).profiles[0].level).toBe(33);
});

test("flush() saves immediately", async () => {
  const { platform, store } = await ready();
  store.getState().createProfile(base);
  await store.getState().flush();
  expect(platform.saves).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(platform.saves).toHaveLength(1); // nothing left pending
});

test("loading saved data restores the active character", async () => {
  const first = await ready();
  const p = first.store.getState().createProfile(base);
  await first.store.getState().flush();
  const second = await ready(first.platform.saves[0]!);
  expect(activeProfile(second.store.getState())?.id).toBe(p.id);
});

test("remove then restore puts the character back where it was", async () => {
  const { store } = await ready();
  const a = store.getState().createProfile({ ...base, name: "A" });
  store.getState().createProfile({ ...base, name: "B" });
  store.getState().setActive(a.id);
  const removed = store.getState().removeProfile(a.id)!;
  expect(store.getState().file.profiles.map((p) => p.name)).toEqual(["B"]);
  expect(activeProfile(store.getState())?.name).toBe("B");
  store.getState().restoreProfile(removed);
  expect(store.getState().file.profiles.map((p) => p.name)).toEqual(["A", "B"]);
  expect(activeProfile(store.getState())?.name).toBe("A");
});

test("a file from a newer app is read-only and never saved over", async () => {
  const newer = JSON.stringify({ schemaVersion: 2, activeProfileId: null, profiles: [] });
  const { platform, store } = await ready(newer);
  expect(store.getState().status).toBe("read-only");
  expect(store.getState().notice).toEqual({ kind: "read-only", version: 2 });
  store.getState().createProfile(base);
  await store.getState().flush();
  expect(platform.saves).toHaveLength(0);
});

test("an unreadable file is not overwritten", async () => {
  const { platform, store } = await ready(JSON.stringify({ schemaVersion: 1, profiles: "oops" }));
  expect(store.getState().status).toBe("read-only");
  expect(store.getState().notice?.kind).toBe("invalid");
  store.getState().updateSettings({ theme: "night" });
  await store.getState().flush();
  expect(platform.saves).toHaveLength(0);
});

test("a failed save is reported and retried on flush", async () => {
  const { platform, store } = await ready();
  const realSave = platform.profilesSave;
  platform.profilesSave = () => Promise.reject(new Error("disk full"));
  store.getState().createProfile(base);
  await store.getState().flush();
  expect(store.getState().saveError).toContain("disk full");
  platform.profilesSave = realSave;
  await store.getState().flush();
  expect(store.getState().saveError).toBeNull();
  expect(platform.saves).toHaveLength(1);
});

test("duplicate gets a new id, no screenshot and a copy name", async () => {
  const { store } = await ready();
  const a = store.getState().createProfile(base);
  const copy = store.getState().duplicateProfile(a.id)!;
  expect(copy.id).not.toBe(a.id);
  expect(copy.name).toBe("Tester copy");
  expect(copy.screenshot).toBeNull();
});
