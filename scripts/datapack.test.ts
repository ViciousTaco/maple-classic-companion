import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { miniPack } from "../src/data/fixtures/miniPack";
import { PACK_FILES } from "../src/data/schema/pack";
import { buildPack } from "./datapack-build";
import { validateDir } from "./datapack-validate";

// @vitest-environment node

/** Writes a pack as a datapack/ source tree (top-level files + one region). */
function writeSource(dir: string, p = miniPack()) {
  const w = (rel: string, v: unknown) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), JSON.stringify(v));
  };
  w("meta.json", p.meta);
  w("formulas.json", p.formulas);
  w("focus-profiles.json", p.focusProfiles);
  w("jobs.json", p.jobs);
  w("unlockables.json", p.unlockables);
  w("events.json", p.events);
  w("videos.json", p.videos);
  w("gear-progression.json", p.gearProgression);
  w("ap-builds.json", p.apBuilds);
  w("news-rules.json", p.newsRules);
  w("skills/thief.json", p.skills);
  w("items/all.json", p.items);
  w("regions/test/maps.json", p.maps);
  w("regions/test/monsters.json", p.monsters);
  w("regions/test/drops.json", p.drops);
  w("regions/test/npcs.json", p.npcs);
  w("regions/test/quests.json", p.quests);
  w("regions/test/training-spots.json", p.trainingSpots);
}

let tmp: string;
beforeEach(() => {
  // Inside the project (the owner: nothing outside E:\Ai Projects\Maple Classic Companion) when TEMP points there.
  tmp = mkdtempSync(join(process.env.TEMP ?? tmpdir(), "mcc-pack-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test("validateDir passes a good source tree and fails a bad one with a clear message", () => {
  writeSource(join(tmp, "good"));
  expect(validateDir(join(tmp, "good")).ok).toBe(true);

  const bad = miniPack();
  bad.maps[1]!.spawns.push({ mobId: "ghost", count: 1 });
  writeSource(join(tmp, "bad"), bad);
  const r = validateDir(join(tmp, "bad"));
  expect(r.ok).toBe(false);
  expect(r.lines).toContain('rule 2 · maps.json · field-a.spawns[1]: unknown monster "ghost"');
});

test("broken JSON in a source file is reported, not thrown", () => {
  writeSource(join(tmp, "src"));
  writeFileSync(join(tmp, "src", "regions", "test", "npcs.json"), "[{oops");
  const r = validateDir(join(tmp, "src"));
  expect(r.ok).toBe(false);
  expect(r.lines.some((l) => l.startsWith("JSON ·") && l.includes("npcs.json"))).toBe(true);
});

test("build writes every pack file and a manifest whose hashes and sizes match", () => {
  writeSource(join(tmp, "src"));
  const out = join(tmp, "out");
  const m = buildPack(join(tmp, "src"), out, new Date("2026-10-05T00:00:00Z"));
  expect(m.files.map((f) => f.path).sort()).toEqual(Object.values(PACK_FILES).sort());
  for (const f of m.files) {
    const body = readFileSync(join(out, f.path));
    expect(createHash("sha256").update(body).digest("hex")).toBe(f.sha256);
    expect(body.byteLength).toBe(f.bytes);
  }
  expect(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"))).toMatchObject({ schema: 1, packVersion: "2026.10.05-1" });
});

test("build refuses an invalid pack", () => {
  const bad = miniPack();
  bad.monsters[0]!.level = 999;
  writeSource(join(tmp, "src"), bad);
  expect(() => buildPack(join(tmp, "src"), join(tmp, "out"))).toThrow(/rule 7/);
});
