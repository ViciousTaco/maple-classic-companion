import { createMockPlatform } from "../../platform/ipc.mock";
import { smallPack } from "../../../tests/fixtures/pack.small";
import { activeProfile, createProfileStore } from "../characters/store";
import { AUTO_OFF_IDLE_MS, AUTO_OFF_NO_WINDOW_MS, createWatcher, type WatchPlatform, type WatchWindow } from "./controller";

const SETUP = {
  windowTitle: "MapleStory",
  sourceWidth: 1366,
  sourceHeight: 768,
  status: { x: 0, y: 740, w: 600, h: 28 },
  chat: { x: 0, y: 560, w: 500, h: 160 },
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
  const screen = { covered: false, status: ["Lv. 25", "EXP [40.00%]"], chat: ["old line before watching"], window: { id: 7, title: "MapleStory", app: "MapleStory.exe", width: 1366, height: 768, minimized: false } as WatchWindow | null };
  const platform: WatchPlatform = {
    screenListWindows: async () => (screen.window ? [screen.window] : []),
    screenRead: async (_id, regions) => regions.map((r) => ({ name: r.name, lines: (r.name === "status" ? screen.status : screen.chat).map((text) => ({ text, x: 0, y: 0, w: 1, h: 1 })), covered: screen.covered })),
  };
  const told: string[] = [];
  const watcher = createWatcher({ platform, store, getPack: () => pack, now: () => t, schedule: () => () => {}, tell: (m) => told.push(m) });
  const advance = async (ms: number, chatAdd: string[] = []) => {
    t += ms;
    screen.chat = [...screen.chat, ...chatAdd].slice(-6);
    await watcher.getState().step();
  };
  const profile = () => activeProfile(store.getState())!;
  return { store, watcher, screen, advance, profile, told };
}

test("off until the owner turns it on; never starts without a setup", async () => {
  const { watcher } = await rig({ setup: false });
  expect(watcher.getState().status).toBe("off");
  await watcher.getState().start("spot-exp");
  expect(watcher.getState().status).toBe("off");
  expect(watcher.getState().problem).toMatch(/Set up the watcher/);
});

test("counts kills seen after switching on, then saves them to the spot when switched off", async () => {
  const { watcher, advance, profile } = await rig();
  await watcher.getState().start("spot-exp");
  expect(watcher.getState().status).toBe("on");
  await advance(2000); // first read only learns the existing chat
  expect(watcher.getState().session!.kills).toBe(0);
  await advance(2000, ["You have gained experience (+24)", "You have gained mesos (+15)"]);
  await advance(2000, ["You have gained experience (+24)", "You have gained an item (Test Item i-cap)"]);
  await advance(2000); // nothing new
  expect(watcher.getState().session).toMatchObject({ kills: 2, exp: 48, meso: 15, items: { "i-cap": 1 } });
  expect(watcher.getState().feed[0]!.text).toBe("Picked up Test Item i-cap");
  expect(watcher.getState().feed.some((f) => f.text === "+24 EXP · Test Mob m-fast")).toBe(true);
  watcher.getState().stop();
  expect(watcher.getState().status).toBe("off");
  expect(profile().observations["spot-exp"]).toMatchObject({ kills: 2, exp: 48, meso: 15, sessions: 1 });
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

test("switches itself off after 20 minutes without a kill", async () => {
  const { watcher, advance } = await rig();
  await watcher.getState().start("spot-exp");
  await advance(2000);
  await advance(2000, ["You have gained experience (+24)"]);
  await advance(AUTO_OFF_IDLE_MS + 1000);
  expect(watcher.getState().status).toBe("off");
});

test("a long run sets the character's measured pace", async () => {
  const { watcher, screen, advance, profile } = await rig();
  await watcher.getState().start("spot-exp");
  screen.status = ["Lv. 25", "[40.00%]"];
  await advance(2000);
  for (let i = 0; i < 400; i++) await advance(2000, [`You have gained experience (+24) #${i}`]);
  screen.status = ["Lv. 25", "[46.00%]"];
  await advance(2000, ["You have gained experience (+24) last"]);
  watcher.getState().stop();
  const pace = profile().pace!;
  expect(pace.minutes).toBeGreaterThan(13);
  expect(pace.percentPerHour).toBeCloseTo(6 / (pace.minutes / 60), 5);
  expect(profile().observations["spot-exp"]!.sessions).toBe(1); // checkpoints don't inflate the run count
});

test("text from a covered box is ignored, then counting carries on", async () => {
  const { watcher, screen, advance } = await rig();
  await watcher.getState().start("spot-exp");
  await advance(2000);
  screen.covered = true;
  await advance(2000, ["You have gained experience (+24)"]);
  expect(watcher.getState().status).toBe("paused");
  expect(watcher.getState().session!.kills).toBe(0);
  screen.covered = false;
  await advance(2000, ["You have gained experience (+24)"]);
  expect(watcher.getState().status).toBe("on");
  expect(watcher.getState().session!.kills).toBe(2); // both gains were still in the chat box
});

test("farming one monster: identical chat lines still count, via the EXP total on the bar", async () => {
  const { watcher, screen, advance } = await rig();
  const same = "You have gained experience (+24)";
  screen.chat = [same, same, same, same];
  screen.status = ["Lv. 25", "EXP 1000 [10.00%]"];
  await watcher.getState().start("spot-exp");
  await advance(2000); // primes
  screen.status = ["Lv. 25", "EXP 1072 [10.50%]"]; // 3 kills; the chat box looks exactly the same
  await advance(2000);
  expect(watcher.getState().session!.kills).toBe(0); // held until the next read confirms the total
  await advance(2000);
  expect(watcher.getState().session).toMatchObject({ kills: 3, exp: 72 });
  await advance(2000);
  expect(watcher.getState().session!.kills).toBe(3); // nothing new, nothing counted
});
