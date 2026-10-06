import { createMockPlatform } from "../../platform/ipc.mock";
import { smallPack } from "../../../tests/fixtures/pack.small";
import { activeProfile, createProfileStore } from "../characters/store";
import { AUTO_OFF_IDLE_MS, AUTO_OFF_NO_WINDOW_MS, createWatcher, type WatchPlatform, type WatchWindow } from "./controller";

const SETUP = {
  windowTitle: "MapleStory",
  sourceWidth: 1366,
  sourceHeight: 768,
  status: { x: 0, y: 740, w: 600, h: 28 },
  chat: null,
  map: null,
  intervalSec: 2,
  diagnostics: false,
  expBar: null,
  expText: null,
  textStyle: "smooth" as const,
  tuning: {},
  savedAt: "2026-10-07T00:00:00.000Z",
};

async function rig(opts: { level?: number; setup?: boolean } = {}) {
  const store = createProfileStore(createMockPlatform(), { debounceMs: 0 });
  await store.getState().load();
  store.getState().createProfile({ name: "Tester", jobId: "thief", level: opts.level ?? 25 });
  if (opts.setup !== false) store.getState().updateSettings({ watch: SETUP });
  const pack = smallPack();
  let t = Date.parse("2026-10-07T00:00:00Z");
  const screen = { covered: false, status: ["Lv. 25", "EXP [40.00%]"], window: { id: 7, title: "MapleStory", app: "MapleStory.exe", width: 1366, height: 768, minimized: false } as WatchWindow | null };
  const platform: WatchPlatform = {
    screenListWindows: async () => (screen.window ? [screen.window] : []),
    screenRead: async (_id, regions) => regions.map((r) => ({ name: r.name, lines: (r.name === "status" ? screen.status : []).map((text) => ({ text, x: 0, y: 0, w: 1, h: 1 })), covered: screen.covered })),
  };
  const told: string[] = [];
  const watcher = createWatcher({ platform, store, getPack: () => pack, now: () => t, schedule: () => () => {}, tell: (m) => told.push(m) });
  const advance = async (ms: number, status?: string[]) => {
    t += ms;
    if (status) screen.status = status;
    await watcher.getState().step();
  };
  const profile = () => activeProfile(store.getState())!;
  return { store, watcher, screen, advance, profile, told };
}

/** The status bar at Lv 25 (a 10,000-EXP level) with this much EXP: the number and its % agree, like the game's. */
const bar = (exp: number) => ["Lv. 25", `EXP ${exp} [${((exp / 10_000) * 100).toFixed(2)}%]`];

test("off until the owner turns it on; never starts without a setup", async () => {
  const { watcher } = await rig({ setup: false });
  expect(watcher.getState().status).toBe("off");
  await watcher.getState().start("spot-exp");
  expect(watcher.getState().status).toBe("off");
  expect(watcher.getState().problem).toMatch(/Set up the watcher/);
});

test("EXP gained comes from the EXP number on the bar, then is saved to the spot when switched off", async () => {
  const { watcher, advance, profile } = await rig();
  await watcher.getState().start("spot-exp");
  expect(watcher.getState().status).toBe("on");
  await advance(2000, bar(4000));
  await advance(2000, bar(4000)); // the first value needs a second read to back it
  await advance(2000, bar(4240)); // 10 kills of Test Mob m-fast (24 EXP) between reads — all counted
  await advance(2000, bar(4480));
  await advance(2000, bar(4480)); // nothing new
  expect(watcher.getState().session).toMatchObject({ exp: 480, kills: 20 }); // kills ≈ EXP ÷ the map's monster EXP
  watcher.getState().stop();
  expect(watcher.getState().status).toBe("off");
  expect(profile().observations["spot-exp"]).toMatchObject({ exp: 480, kills: 20, sessions: 1 });
  expect(watcher.getState().lastSummary).toMatchObject({ exp: 480 });
});

test("the character's level follows the game once three reads agree", async () => {
  const { watcher, screen, advance, profile, told } = await rig({ level: 25 });
  await watcher.getState().start("spot-exp");
  screen.status = ["Lv. 26", "[3.10%]"];
  await advance(2000);
  await advance(2000);
  expect(profile().level).toBe(25); // two reads aren't enough (OCR slips)
  await advance(2000);
  expect(profile().level).toBe(26);
  expect(profile().expPercent).toBe(3.1);
  expect(told[0]).toMatch(/Level 26/);
});

test("pauses when the game is minimised and switches itself off (never on) after 5 minutes", async () => {
  const { watcher, screen, advance } = await rig();
  await watcher.getState().start("spot-exp");
  await advance(2000);
  screen.window = { ...screen.window!, minimized: true };
  await advance(2000);
  expect(watcher.getState().status).toBe("paused");
  expect(watcher.getState().problem).toMatch(/minimised/);
  screen.window = { ...screen.window, minimized: false };
  await advance(2000);
  expect(watcher.getState().status).toBe("on");
  screen.window = null;
  await advance(2000);
  await advance(AUTO_OFF_NO_WINDOW_MS);
  expect(watcher.getState().status).toBe("off");
  expect(watcher.getState().problem).toMatch(/switched itself off/);
});

test("a resized game window asks for setup again instead of reading the wrong boxes", async () => {
  const { watcher, screen, advance } = await rig();
  screen.window = { ...screen.window!, width: 1920, height: 1080 };
  await watcher.getState().start("spot-exp");
  await advance(2000);
  expect(watcher.getState().status).toBe("paused");
  expect(watcher.getState().problem).toMatch(/changed size/);
});

test("switches itself off after 20 minutes without EXP", async () => {
  const { watcher, advance } = await rig();
  await watcher.getState().start("spot-exp");
  await advance(2000, bar(4000));
  await advance(2000, bar(4000));
  await advance(2000, bar(4240));
  await advance(2000, bar(4480));
  await advance(AUTO_OFF_IDLE_MS + 1000);
  expect(watcher.getState().status).toBe("off");
  expect(watcher.getState().problem).toMatch(/No EXP gained for 20 minutes/);
});

test("a long run sets the character's measured pace", async () => {
  const { watcher, advance, profile } = await rig();
  await watcher.getState().start("spot-exp");
  await advance(2000, bar(4000));
  await advance(2000, bar(4000));
  for (let i = 1; i <= 400; i++) await advance(2000, bar(4000 + Math.round((600 * i) / 400)));
  watcher.getState().stop();
  const pace = profile().pace!;
  expect(pace.minutes).toBeGreaterThan(13);
  expect(pace.percentPerHour).toBeCloseTo(6 / (pace.minutes / 60), 5);
  expect(profile().observations["spot-exp"]!.sessions).toBe(1); // checkpoints don't inflate the run count
  expect(profile().observations["spot-exp"]!.exp).toBe(600);
});

test("EXP gained while a box was covered isn't lost: the next good read counts it", async () => {
  const { watcher, screen, advance } = await rig();
  await watcher.getState().start("spot-exp");
  await advance(2000, bar(4000));
  await advance(2000, bar(4000));
  await advance(2000, bar(4240)); // a 2.4 % jump before the pace is known: waits for the next read…
  await advance(2000, bar(4480)); // …which backs it
  expect(watcher.getState().session!.exp).toBe(480);
  screen.covered = true;
  await advance(2000, bar(4720));
  expect(watcher.getState().status).toBe("paused");
  expect(watcher.getState().session!.exp).toBe(480);
  screen.covered = false;
  await advance(2000, bar(4960));
  expect(watcher.getState().status).toBe("on");
  expect(watcher.getState().session!.exp).toBe(960);
});

test("live client: only the % reads; with the level's size typed in once, EXP gained comes from the % — misreads ignored", async () => {
  const { store, watcher, advance } = await rig();
  const size = 5_521_000_000_000;
  store.getState().updateSettings({ watch: { ...store.getState().file.settings.watch!, levelSizes: { "25": size } } });
  await watcher.getState().start("spot-exp");
  const pct = (p: string) => ["Lv. 25", `[${p}%]`];
  // The owner's log (2026-10-07), in order: the real %, plus the misreads "7" (the same frame read twice) and "72".
  for (const p of ["72.680", "72.680", "72.684", "7", "7", "72.684", "72.686", "72", "72.687", "72.687"]) await advance(2000, pct(p));
  expect(watcher.getState().fields.expPercent?.value).toBe(72.687);
  expect(watcher.getState().session!.exp).toBe(Math.round((size * 0.007) / 100)); // 0.007 % of the level, nothing more
});
