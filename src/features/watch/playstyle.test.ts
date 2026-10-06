import { createMockPlatform } from "../../platform/ipc.mock";
import { smallPack } from "../../../tests/fixtures/pack.small";
import { activeProfile, createProfileStore } from "../characters/store";
import { createWatcher, type WatchPlatform, type WatchWindow } from "./controller";
import { matchName, parseMapName, parseStatus } from "./parse";

// I-29 follow-ups (owner): moving between maps, mobbing faster than any read, other players on screen,
// and making sure it's the owner's own character being read.

const SETUP = {
  windowTitle: "MapleStory",
  sourceWidth: 1366,
  sourceHeight: 768,
  status: { x: 0, y: 740, w: 600, h: 28 },
  chat: null,
  map: { x: 0, y: 0, w: 200, h: 30 },
  intervalSec: 2,
  diagnostics: false,
  expBar: null,
  expText: null,
  textStyle: "smooth" as const,
  tuning: {},
  savedAt: "2026-10-07T00:00:00.000Z",
};

const TEST_QUEST = {
  id: "q-test",
  name: "Test quest",
  category: "regular",
  minLevel: 1,
  startNpcId: "npc-x",
  steps: [{ text: "Talk", kind: "talk" }],
  rewards: {},
  sources: [{ kind: "wiki", label: "w", retrievedAt: "2026-10-05" }],
  confidence: "likely",
};

async function rig(opts: { name?: string; map?: boolean; quest?: boolean } = {}) {
  const store = createProfileStore(createMockPlatform(), { debounceMs: 0 });
  await store.getState().load();
  store.getState().createProfile({ name: opts.name ?? "Taco", jobId: "thief", level: 25 });
  store.getState().updateSettings({ watch: opts.map === false ? { ...SETUP, map: null } : SETUP });
  const pack = smallPack((d) => {
    if (opts.quest) d.quests.push(TEST_QUEST as never);
  });
  let t = Date.parse("2026-10-07T00:00:00Z");
  const screen = {
    status: ["Lv. 25  Taco  EXP 1000 [40.00%]"],
    map: ["Test Map f-exp"],
    window: { id: 7, title: "MapleStory", app: "MapleStory.exe", width: 1366, height: 768, minimized: false } as WatchWindow | null,
  };
  const platform: WatchPlatform = {
    screenListWindows: async () => (screen.window ? [screen.window] : []),
    screenRead: async (_id, regions) =>
      regions.map((r) => ({
        name: r.name,
        lines: ((screen as unknown as Record<string, string[] | undefined>)[r.name] ?? []).map((text, i) => ({ text, x: 0, y: i * 20, w: text.length * 8, h: 16 })),
        covered: false,
      })),
  };
  const told: string[] = [];
  const watcher = createWatcher({ platform, store, getPack: () => pack, now: () => t, schedule: () => () => {}, tell: (m) => told.push(m) });
  const advance = async (ms: number, status?: string[]) => {
    t += ms;
    if (status) screen.status = status;
    await watcher.getState().step();
  };
  return { store, watcher, screen, advance, profile: () => activeProfile(store.getState())!, told, pack };
}

/** Taco's status bar at Lv 25 (a 2,500-EXP level in this rig): the EXP number and its % agree, like the game's. */
const bar = (exp: number) => [`Lv. 25  Taco  EXP ${exp} [${((exp / 2500) * 100).toFixed(2)}%]`];

test("the status bar gives the character's name; map names tolerate OCR but not ambiguity", () => {
  expect(parseStatus(["Lv. 23  Demo  EXP 51402 [44.17%]"]).name).toBe("Demo");
  expect(parseStatus(["Lv. 23", "Demo", "HP 300/300"]).name).toBe("Demo");
  expect(parseStatus(["Lv. 23 EXP 100 [1.00%]"]).name).toBeNull(); // no name in the box
  const maps = ["Ant Tunnel I", "Ant Tunnel II", "Ant Tunnel IV", "Henesys Hunting Ground I"];
  expect(parseMapName(["Victoria Island", "Ant Tunnel IV", "Ch. 3"], maps)).toBe("Ant Tunnel IV");
  expect(parseMapName(["Henesys Hunting Grounc I"], maps)).toBe("Henesys Hunting Ground I");
  expect(matchName("Ant Tunnel I1", ["Ant Tunnel I", "Ant Tunnel II"])).toBeNull(); // equally close to both → say nothing
  expect(parseMapName(["Free Market"], maps)).toBeNull();
  // Real Windows OCR (2026-10-06): "Ant Tunnel III" came back as "Ant Tunnel Ill".
  expect(parseMapName(["Victoria Island", "Ant Tunnel Ill Ch. 3"], [...maps, "Ant Tunnel III"])).toBe("Ant Tunnel III");
  expect(parseMapName(["Ant Tunnel ll"], [...maps, "Ant Tunnel III"])).toBe("Ant Tunnel II");
});

test("moving between maps: EXP is banked per map and the next map's spot takes over", async () => {
  const { watcher, screen, advance, profile } = await rig();
  await watcher.getState().start();
  expect(watcher.getState().autoMap).toBe(true);
  await advance(2000, bar(1000)); // primes; minimap says f-exp
  expect(watcher.getState().mapId).toBe("f-exp");
  await advance(2000, bar(1024));
  await advance(2000, bar(1048));
  screen.map = ["Test Map f-meso"]; // walked through the portal
  await advance(2000, bar(1066));
  expect(watcher.getState().mapId).toBe("f-meso");
  expect(watcher.getState().spotId).toBe("spot-meso");
  expect(watcher.getState().feed.some((f) => f.text === "Moved to Test Map f-meso")).toBe(true);
  // The EXP gained on the new map counts there, and its kills from that map's monster (Test Mob m-rich, 18 EXP).
  expect(watcher.getState().session).toMatchObject({ exp: 18, kills: 1 });
  watcher.getState().stop();
  const obs = profile().observations;
  expect(obs["spot-exp"]).toMatchObject({ kills: 2, exp: 48 });
  expect(obs["spot-meso"]).toMatchObject({ kills: 1, exp: 18 });
});

test("a map with no training spot in the guide still counts, under the map's own key", async () => {
  const { watcher, screen, advance, profile } = await rig();
  await watcher.getState().start();
  await advance(2000, bar(1000));
  await advance(2000, bar(1000));
  screen.map = ["Test Map town"]; // a map without a spot
  await advance(2000, bar(1024));
  expect(watcher.getState().spotId).toBeNull();
  expect(watcher.getState().feed.some((f) => /no training spot in the guide/.test(f.text))).toBe(true);
  watcher.getState().stop();
  expect(profile().observations["map:town"]).toMatchObject({ exp: 24, kills: 0 }); // no monsters known there: no kill estimate
});

test("picking a spot by hand stops following the minimap until 'wherever you are' is chosen again", async () => {
  const { watcher, screen, advance } = await rig();
  await watcher.getState().start();
  await advance(2000);
  watcher.getState().setSpot("spot-drop");
  screen.map = ["Test Map f-meso"];
  await advance(2000);
  expect(watcher.getState().spotId).toBe("spot-drop"); // ignored the minimap
  watcher.getState().followMap();
  await advance(2000);
  expect(watcher.getState().spotId).toBe("spot-meso");
});

test("mobbing: every kill counts, however many happen between two reads", async () => {
  const { watcher, advance } = await rig({ map: false });
  await watcher.getState().start("spot-exp");
  await advance(2000, bar(1000));
  await advance(2000, bar(1240)); // 10 kills in 2 s (+9.6 %): a big jump waits for the next read to back it…
  await advance(2000, bar(1312)); // …which it does (3 more kills)
  expect(watcher.getState().session).toMatchObject({ exp: 312, kills: 13 });
});

test("a misread EXP number can't invent EXP", async () => {
  const { watcher, advance } = await rig({ map: false });
  await watcher.getState().start("spot-exp");
  await advance(2000, bar(1000));
  await advance(2000, bar(1000));
  await advance(2000, ["Lv. 25  Taco  EXP 1072 [40.00%]"]); // OCR slip: 1000 read as 1072, the % says otherwise
  await advance(2000, bar(1000)); // back to the truth
  await advance(2000, bar(1000));
  expect(watcher.getState().session!.exp).toBe(0);
});

test("the character always shows the level the screen shows, even past the guide's data", async () => {
  const { watcher, screen, advance, profile } = await rig({ map: false });
  await watcher.getState().start("spot-exp");
  screen.status = ["Lv. 272  Taco  EXP 1 [0.10%]"];
  for (let i = 0; i < 3; i++) await advance(2000);
  expect(profile().level).toBe(272);
  expect(watcher.getState().feed.some((f) => /data stops at Lv 100/.test(f.text))).toBe(true);
});

test("reading another character's status bar pauses watching instead of counting it", async () => {
  const { watcher, screen, advance } = await rig({ name: "Taco" });
  await watcher.getState().start("spot-exp");
  await advance(2000);
  screen.status = ["Lv. 40  SomeoneElse  EXP 9000 [10.00%]"];
  await advance(2000);
  await advance(2000);
  expect(watcher.getState().status).toBe("on"); // two reads: could be an OCR slip
  await advance(2000);
  expect(watcher.getState().status).toBe("paused");
  expect(watcher.getState().problem).toMatch(/SomeoneElse.*Taco/);
  screen.status = ["Lv. 25  Taco  EXP 1000 [40.00%]"];
  await advance(2000);
  expect(watcher.getState().status).toBe("on");
  // An OCR slip in the name ("Tac0") is tolerated.
  screen.status = ["Lv. 25  Tac0  EXP 1000 [40.00%]"];
  for (let i = 0; i < 4; i++) await advance(2000);
  expect(watcher.getState().status).toBe("on");
});

test("the open Stats / Skills window updates the character, after two whole-window reads agree", async () => {
  const { watcher, screen, advance, profile } = await rig({ map: false });
  const full = (screen as unknown as Record<string, string[]>);
  full.full = [];
  await watcher.getState().start("spot-exp");
  await advance(2000);
  // Owner opens the Stats window. Whole-window reads happen every 5 s; once a window is seen, the confirming read
  // comes on the very next tick.
  full.full = ["STR 35", "DEX 25", "INT 4", "LUK 60", "HP 912 / 912", "Damage 40 ~ 90", "Test Multi Skill 5 / 20"];
  await advance(2000);
  expect(watcher.getState().lastScan).toBeNull(); // not time for a whole-window read yet
  await advance(3000);
  expect(profile().stats.str).toBeUndefined(); // first read: waiting for confirmation
  expect(watcher.getState().lastScan).toMatchObject({ applied: false, skills: 1 });
  await advance(2000);
  expect(profile().stats).toMatchObject({ str: 35, dex: 25, int: 4, luk: 60, hp: 912 });
  expect(profile().combat).toMatchObject({ damageMin: 40, damageMax: 90 });
  expect(profile().skills["sk-multi"]).toBe(5);
  expect(watcher.getState().feed[0]!.text).toMatch(/^Updated from the game: STR 35/);
  // One noisy read changes nothing.
  full.full = ["STR 85", "DEX 25", "INT 4", "LUK 60"];
  await advance(5000);
  full.full = ["STR 35", "DEX 25", "INT 4", "LUK 60"]; // the next (confirming) read disagrees → nothing applied
  await advance(2000);
  expect(profile().stats.str).toBe(35);
  // The on-demand read works too, and says when nothing is open.
  full.full = [];
  expect(await watcher.getState().scanNow()).toMatch(/No Stats, Skills or Quest window/);
});

test("run totals and the training log survive checkpoints; stopping leaves a summary", async () => {
  const { watcher, advance, profile } = await rig({ map: false });
  await watcher.getState().start("spot-exp");
  await advance(2000, bar(1000));
  for (let i = 1; i <= 4; i++) await advance(2000, bar(1000 + 24 * i));
  // 5-minute checkpoint: the session resets but the run keeps counting.
  await advance(5 * 60_000 + 1000, bar(1120));
  expect(watcher.getState().run.exp).toBeGreaterThanOrEqual(96);
  expect(watcher.getState().run.exp + watcher.getState().session!.exp).toBe(120);
  expect(profile().trainingLog).toHaveLength(1); // one stretch at one map so far
  await advance(2000, bar(1144));
  watcher.getState().stop();
  const log = profile().trainingLog;
  expect(log).toHaveLength(1); // checkpoints merged into the same stretch
  expect(log[0]).toMatchObject({ key: "spot-exp", kills: 6, exp: 144, level: 25 });
  expect(watcher.getState().lastSummary).toMatchObject({ kills: 6, exp: 144, level: 25, maps: ["f-exp"] });
});

test("reads slower than the interval stretch the next wait instead of piling up", async () => {
  const store = createProfileStore(createMockPlatform(), { debounceMs: 0 });
  await store.getState().load();
  store.getState().createProfile({ name: "Taco", jobId: "thief", level: 25 });
  store.getState().updateSettings({ watch: { ...SETUP, map: null, intervalSec: 1 } });
  let t = 0;
  const delays: number[] = [];
  let fire: (() => void) | null = null;
  const platform: WatchPlatform = {
    screenListWindows: async () => [{ id: 7, title: "MapleStory", app: "", width: 1366, height: 768, minimized: false }],
    screenRead: async (_id, regions) => {
      t += 2500; // every read takes 2.5 s
      return regions.map((r) => ({ name: r.name, lines: [], covered: false }));
    },
  };
  const w = createWatcher({ platform, store, getPack: () => smallPack(), now: () => t, schedule: (fn, ms) => { delays.push(ms); fire = fn; return () => {}; } });
  await w.getState().start("spot-exp");
  expect(delays[0]).toBe(1000);
  await fire!();
  expect(delays[1]).toBe(3750); // 2.5 s × 1.5
  expect(w.getState().effectiveIntervalMs).toBe(3750);
});

test("the Quest window marks quests in progress and completed, never un-completing anything", async () => {
  const { watcher, screen, advance, profile, pack } = await rig({ map: false, quest: true });
  const q = pack.quests[0]!;
  const full = screen as unknown as Record<string, string[]>;
  await watcher.getState().start("spot-exp");
  await advance(2000);
  full.full = ["In Progress", q.name];
  await advance(5000);
  await advance(2000);
  expect(profile().unlocks.questsActive).toEqual([q.id]);
  full.full = ["Completed", q.name];
  await advance(5000);
  await advance(2000);
  expect(profile().unlocks.questsDone).toEqual([q.id]);
  expect(profile().unlocks.questsActive).toEqual([]);
});

test("the diagnostic log gets one text line per read only while switched on", async () => {
  const lines: string[] = [];
  const store = createProfileStore(createMockPlatform(), { debounceMs: 0 });
  await store.getState().load();
  store.getState().createProfile({ name: "Taco", jobId: "thief", level: 25 });
  store.getState().updateSettings({ watch: { ...SETUP, map: null, diagnostics: true } });
  let t = Date.parse("2026-10-07T00:00:00Z");
  const platform: WatchPlatform = {
    screenListWindows: async () => [{ id: 7, title: "MapleStory", app: "", width: 1366, height: 768, minimized: false }],
    screenRead: async (_id, regions) => regions.map((r) => ({ name: r.name, lines: r.name === "status" ? [{ text: "Lv. 25  Taco  EXP 1000 [40.00%]", x: 0, y: 0, w: 1, h: 1 }] : [], covered: false })),
    watchLogAppend: async (line) => {
      lines.push(line);
      return "x.jsonl";
    },
  };
  const w = createWatcher({ platform, store, getPack: () => smallPack(), now: () => t, schedule: () => () => {} });
  await w.getState().start("spot-exp");
  t += 2000;
  await w.getState().step();
  expect(lines).toHaveLength(1);
  const entry = JSON.parse(lines[0]!);
  expect(entry.status).toEqual(["Lv. 25  Taco  EXP 1000 [40.00%]"]);
  expect(entry).not.toHaveProperty("png");
  store.getState().updateSettings({ watch: { ...SETUP, map: null, diagnostics: false } });
  t += 2000;
  await w.getState().step();
  expect(lines).toHaveLength(1);
});

test("EXP bar fill stands in for the % when the digits can't be read", async () => {
  const store = createProfileStore(createMockPlatform(), { debounceMs: 0 });
  await store.getState().load();
  store.getState().createProfile({ name: "Taco", jobId: "thief", level: 25 });
  store.getState().updateSettings({ watch: { ...SETUP, map: null, expBar: { x: 0, y: 760, w: 600, h: 6 } } });
  let t = Date.parse("2026-10-07T00:00:00Z");
  let fill = 0.4;
  const platform: WatchPlatform = {
    screenListWindows: async () => [{ id: 7, title: "MapleStory", app: "", width: 1366, height: 768, minimized: false }],
    screenRead: async (_id, regions) =>
      regions.map((r) => ({
        name: r.name,
        lines: r.name === "status" ? [{ text: "Lv. 25  Taco  EXP 51402", x: 0, y: 0, w: 1, h: 1 }] : [],
        covered: false,
        ...(r.mode === "bar" ? { fill } : {}),
      })),
  };
  const w = createWatcher({ platform, store, getPack: () => smallPack(), now: () => t, schedule: () => () => {} });
  await w.getState().start("spot-exp");
  t += 2000;
  await w.getState().step();
  expect(w.getState().read).toMatchObject({ level: 25, expPercent: 40 });
  fill = 0.4123;
  t += 2000;
  await w.getState().step();
  expect(w.getState().read?.expPercent).toBe(41.2);
  expect(w.getState().session?.startExp).toBe(40);
  expect(w.getState().session?.lastExp).toBe(41.2);
});

test("a rising EXP bar keeps the training clock running, even with only its fill to go on", async () => {
  const store = createProfileStore(createMockPlatform(), { debounceMs: 0 });
  await store.getState().load();
  store.getState().createProfile({ name: "Taco", jobId: "thief", level: 25 });
  store.getState().updateSettings({ watch: { ...SETUP, map: null, expBar: { x: 0, y: 760, w: 600, h: 6 } } });
  let t = Date.parse("2026-10-07T00:00:00Z");
  let fill = 0.4;
  const platform: WatchPlatform = {
    screenListWindows: async () => [{ id: 7, title: "MapleStory", app: "", width: 1366, height: 768, minimized: false }],
    screenRead: async (_id, regions) =>
      regions.map((r) => ({ name: r.name, lines: r.name === "status" ? [{ text: "Lv. 25  Taco", x: 0, y: 0, w: 1, h: 1 }] : [], covered: false, ...(r.mode === "bar" ? { fill } : {}) })),
  };
  const w = createWatcher({ platform, store, getPack: () => smallPack(), now: () => t, schedule: () => () => {} });
  await w.getState().start("spot-exp");
  for (let i = 0; i < 10; i++) {
    t += 2000;
    fill += 0.002;
    await w.getState().step();
  }
  const s = w.getState().session!;
  expect(s.kills).toBe(0);
  expect(s.activeMs).toBeGreaterThanOrEqual(16_000); // the clock ran because EXP kept rising
  expect(w.getState().read?.expPercent).toBeCloseTo(42, 0);
});

test("a missed read keeps the last good value (with its time); the EXP total needs two agreeing reads", async () => {
  const { watcher, screen, advance } = await rig({ map: false });
  await watcher.getState().start("spot-exp");
  screen.status = ["Lv. 25  Taco  EXP 51402 [40.00%]"];
  await advance(2000);
  const first = watcher.getState().fields;
  expect(first.level?.value).toBe(25);
  expect(first.expPercent?.value).toBe(40);
  screen.status = []; // OCR returned nothing this tick
  await advance(2000);
  expect(watcher.getState().fields.level?.value).toBe(25);
  expect(watcher.getState().fields.level?.at).toBe(first.level?.at);
});

test("turning Analyse on always follows the minimap when a map box is set up", async () => {
  const { watcher, advance } = await rig();
  await watcher.getState().start("spot-drop"); // the screen's switch passes the planned spot
  expect(watcher.getState().autoMap).toBe(true);
  await advance(2000);
  expect(watcher.getState().mapId).toBe("f-exp");
  expect(watcher.getState().fields.map?.value).toBe("Test Map f-exp");
});

test("one misread never replaces a good value; two agreeing reads do (owner's log: 72.67% → 3%, map glitches)", async () => {
  const { updateFields, newStabilizer, NO_FIELDS } = await import("./reading");
  const stab = newStabilizer();
  const r = (o: object) => ({ level: null, name: null, expPercent: null, expValue: null, mapLines: [], ...o });
  let f = updateFields(NO_FIELDS, r({ level: 272, expPercent: 72.674, mapLines: ["Esfera", "Living Spring 5"] }), 1, stab);
  f = updateFields(f, r({ mapLines: ["Esfera", "Living Spring 5"] }), 2, stab);
  expect(f.map?.value).toBe("Living Spring 5");
  f = updateFields(f, r({ expPercent: 3, mapLines: ["Esfera", "Living SP{ing 5", "1"] }), 3, stab);
  expect(f.expPercent?.value).toBe(72.674); // impossible jump ignored
  expect(f.map?.value).toBe("Living Spring 5"); // a single garbled read never shows
  f = updateFields(f, r({ expPercent: 72.69 }), 4, stab);
  expect(f.expPercent?.value).toBe(72.69); // consistent: accepted
  f = updateFields(f, r({ level: 273, expPercent: 0.12 }), 5, stab);
  f = updateFields(f, r({ level: 273, expPercent: 0.13 }), 6, stab);
  expect(f.level?.value).toBe(273); // a level-up is confirmed by the next read…
  expect(f.expPercent?.value).toBe(0.13); // …and the % resets with it
  f = updateFields(f, r({ mapLines: ["Esfera", "Base Camp"] }), 7, stab);
  f = updateFields(f, r({ mapLines: ["Esfera", "Base Camp"] }), 8, stab);
  f = updateFields(f, r({ mapLines: ["Esfera", "Base Camp"] }), 9, stab);
  expect(f.map?.value).toBe("Base Camp"); // moving map: the new name wins once it's the most read
});

test("live self-tuning switches a box to the method that actually reads on this screen", async () => {
  const { watcher, screen, advance, store } = await rig({ map: false });
  // Setup chose a method that reads nothing for the status box; "light text" reads the level.
  store.getState().updateSettings({ watch: { ...store.getState().file.settings.watch!, tuning: { status: { prep: "brightText", filter: "bilinear" } } } });
  await watcher.getState().start("spot-exp");
  screen.status = ["Lv. 25  Taco  EXP 1000 [40.00%]"];
  for (let i = 0; i < 12; i++) await advance(10_000);
  // The mock reads the same text with every method, so all score alike: no needless switching.
  expect(store.getState().file.settings.watch!.tuning.status).toEqual({ prep: "brightText", filter: "bilinear" });
});

test("live self-tuning: when only one method reads a box, Analyse switches to it and saves it", async () => {
  const store = createProfileStore(createMockPlatform(), { debounceMs: 0 });
  await store.getState().load();
  store.getState().createProfile({ name: "Taco", jobId: "thief", level: 25 });
  store.getState().updateSettings({ watch: { ...SETUP, map: null, tuning: { status: { prep: "brightText", filter: "bilinear" } } } });
  let t = Date.parse("2026-10-07T00:00:00Z");
  const platform: WatchPlatform = {
    screenListWindows: async () => [{ id: 7, title: "MapleStory", app: "", width: 1366, height: 768, minimized: false }],
    // Only "light text" reads the status box on this "screen".
    screenRead: async (_id, regions) =>
      regions.map((r) => ({
        name: r.name,
        lines: r.name.startsWith("status") && r.prep === "lightText" ? [{ text: "Lv. 25 Taco", x: 0, y: 0, w: 1, h: 1 }] : [],
        covered: false,
      })),
  };
  const w = createWatcher({ platform, store, getPack: () => smallPack(), now: () => t, schedule: () => () => {} });
  await w.getState().start("spot-exp");
  for (let i = 0; i < 6; i++) {
    t += 10_000;
    await w.getState().step();
  }
  expect(store.getState().file.settings.watch!.tuning.status?.prep).toBe("lightText");
  t += 2000;
  await w.getState().step();
  expect(w.getState().fields.level?.value).toBe(25); // and the main read now uses it
});
