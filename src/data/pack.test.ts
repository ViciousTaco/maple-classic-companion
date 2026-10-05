import { miniPack } from "./fixtures/miniPack";
import { buildIndexes, bundledSource, loadPack, type PackSource } from "./pack";
import { PACK_FILES } from "./schema/pack";

const fileMap = (p = miniPack()) =>
  Object.fromEntries(Object.entries(PACK_FILES).map(([k, f]) => [f, (p as Record<string, unknown>)[k]]));

const source = (kind: PackSource["kind"], files: Record<string, unknown>): PackSource => ({
  kind,
  read: async (f) => {
    if (!(f in files)) throw new Error(`${f}: missing`);
    return structuredClone(files[f]);
  },
});

test("indexes are built correctly", () => {
  const { index } = buildIndexes(miniPack());
  expect(index.monsterById.get("mob-a")?.name).toBe("Test Mob A");
  expect(index.dropsByMob.get("mob-a")?.map((d) => d.itemId)).toEqual(["item-a"]);
  expect(index.dropsByItem.get("item-a")?.map((d) => d.mobId)).toEqual(["mob-a"]);
  expect(index.spotsByMap.get("field-a")?.map((s) => s.id)).toEqual(["spot-a"]);
  expect(index.questsByNpc.get("npc-a")?.map((q) => q.id)).toEqual(["quest-a"]);
  expect(index.linksFrom.get("field-a")?.map((l) => l.to)).toEqual(["town-a", "field-b"]);
  expect(index.spotsByMap.get("town-a")).toBeUndefined();
});

test("loads the installed pack when it is good", async () => {
  const r = await loadPack([source("installed", fileMap()), source("bundled", fileMap())]);
  expect(r).toMatchObject({ ok: true, from: "installed", fellBack: null });
});

test("a corrupt installed pack falls back to the bundled one", async () => {
  const broken = fileMap();
  broken["monsters.json"] = [{ id: "mob-a" }]; // missing required fields
  const r = await loadPack([source("installed", broken), source("bundled", fileMap())]);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.from).toBe("bundled");
    expect(r.fellBack?.from).toBe("installed");
    expect(r.fellBack?.problem).toMatch(/monsters\.json/);
  }
});

test("a pack with broken references is rejected (rule 2) and a missing file too", async () => {
  const badRefs = fileMap();
  (badRefs["drops.json"] as { mobId: string }[])[0]!.mobId = "ghost";
  const missing = fileMap();
  delete missing["quests.json"];
  const r = await loadPack([source("installed", badRefs), source("bundled", missing)]);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.problems[0]).toMatch(/unknown monster "ghost"/);
    expect(r.problems[1]).toMatch(/quests\.json/);
  }
});

test("a stalled bundled read times out instead of hanging", async () => {
  const stall = ((_url: string, init?: RequestInit) =>
    new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
  await expect(bundledSource(stall, "baseline/", 50).read("meta.json")).rejects.toThrow("meta.json: timed out");
});
