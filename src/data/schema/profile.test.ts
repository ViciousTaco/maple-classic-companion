import { ProfileSchema, emptyProfilesFile } from "./profile";
import { migrate } from "./migrations";

const minimal = {
  id: "0b9f8a52-6a4e-4a39-9c55-2f1d1f7f0a11",
  name: "Tester",
  createdAt: "2026-10-05T10:00:00.000Z",
  updatedAt: "2026-10-05T10:00:00.000Z",
  jobId: "beginner",
  level: 1,
};

test("defaults fill from a minimal object", () => {
  const p = ProfileSchema.parse(minimal);
  expect(p.focus).toBe("balanced");
  expect(p.expPercent).toBeNull();
  expect(p.stats).toEqual({});
  expect(p.combat).toEqual({});
  expect(p.unlocks).toEqual({
    areas: [],
    questsDone: [],
    questsActive: [],
    bossesDefeated: [],
    partyQuests: [],
    citizenship: null,
    crafting: {},
  });
  expect(p.lastView).toBe("/home");
  expect(p.archived).toBe(false);
});

test("level 0 and 301 are rejected", () => {
  expect(ProfileSchema.safeParse({ ...minimal, level: 0 }).success).toBe(false);
  expect(ProfileSchema.safeParse({ ...minimal, level: 301 }).success).toBe(false);
  expect(ProfileSchema.safeParse({ ...minimal, level: 300 }).success).toBe(true);
});

test("unknown jobId is rejected", () => {
  expect(ProfileSchema.safeParse({ ...minimal, jobId: "night-lord" }).success).toBe(false);
});

test("name is trimmed and limited", () => {
  expect(ProfileSchema.parse({ ...minimal, name: "  Taco  " }).name).toBe("Taco");
  expect(ProfileSchema.safeParse({ ...minimal, name: "   " }).success).toBe(false);
  expect(ProfileSchema.safeParse({ ...minimal, name: "x".repeat(25) }).success).toBe(false);
});

test("an empty file has default settings", () => {
  expect(emptyProfilesFile().settings).toEqual({
    timeZoneMode: "sydney",
    motion: "system",
    theme: "system",
    window: null,
  });
});

test("migrate accepts a v1 file and fills defaults", () => {
  const r = migrate({ schemaVersion: 1, activeProfileId: minimal.id, profiles: [minimal] });
  expect(r.kind).toBe("ok");
  if (r.kind === "ok") expect(r.file.profiles[0]?.focus).toBe("balanced");
});

test("a file with schemaVersion 2 yields the read-only result", () => {
  const r = migrate({ schemaVersion: 2, activeProfileId: null, profiles: [minimal], extra: true });
  expect(r.kind).toBe("read-only");
  if (r.kind === "read-only") {
    expect(r.version).toBe(2);
    expect(r.file?.profiles).toHaveLength(1);
  }
});

test("garbage is reported as invalid, not thrown", () => {
  expect(migrate(null).kind).toBe("invalid");
  expect(migrate([]).kind).toBe("invalid");
  expect(migrate({ schemaVersion: "1" }).kind).toBe("invalid");
  expect(migrate({ schemaVersion: 1, profiles: "x" }).kind).toBe("invalid");
});
