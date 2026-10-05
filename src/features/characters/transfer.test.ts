import { ProfileSchema } from "../../data/schema/profile";
import { buildExport, exportFileName, parseImport } from "./transfer";

const profile = ProfileSchema.parse({
  id: "0b9f8a52-6a4e-4a39-9c55-2f1d1f7f0a11",
  name: "Taco",
  createdAt: "2026-10-05T10:00:00.000Z",
  updatedAt: "2026-10-05T10:00:00.000Z",
  jobId: "bandit",
  level: 33,
  stats: { luk: 120 },
  unlocks: { bossesDefeated: ["mano"] },
});
const NEW_ID = "11111111-2222-4333-8444-555555555555";
const now = new Date("2026-10-06T00:00:00.000Z");

test("export → import round-trips with a new id and the screenshot", () => {
  const shot = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 250]);
  const r = parseImport(buildExport(profile, shot, now), NEW_ID, now);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.profile.id).toBe(NEW_ID);
  expect(r.profile.name).toBe("Taco");
  expect(r.profile.stats.luk).toBe(120);
  expect(r.profile.unlocks.bossesDefeated).toEqual(["mano"]);
  expect(r.profile.screenshot).toBeNull(); // re-saved by the caller under the new id
  expect(r.screenshot).toEqual(shot);
});

test("malformed imports are rejected with a readable message", () => {
  const bad = (t: string) => {
    const r = parseImport(t, NEW_ID, now);
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.error;
  };
  expect(bad("{nope")).toMatch(/isn't valid JSON/);
  expect(bad('{"hello":1}')).toMatch(/isn't a Maple Classic Companion character export/);
  const wrongLevel = buildExport({ ...profile, level: 999 }, null, now);
  expect(bad(wrongLevel)).toMatch(/level/);
});

test("export file names are Windows-safe", () => {
  expect(exportFileName(profile, "Bandit")).toBe("Taco Lv33 Bandit.json");
  expect(exportFileName({ ...profile, name: 'a<b>:"/\\|?*c' }, "Wizard (Fire/Poison)")).toBe("abc Lv33 Wizard FirePoison.json");
});
