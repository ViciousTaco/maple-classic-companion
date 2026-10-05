import type { GameEvent } from "../../data/schema/pack";
import { remindersBetween } from "./reminders";

const ev = (id: string, kind: GameEvent["kind"], windows: GameEvent["windows"], extra: Partial<GameEvent> = {}) =>
  ({ id, title: id, kind, windows, howTo: "Talk to the GM", rewards: "", articleId: 1, articleHash: "0".repeat(64), sources: [], confidence: "verified", ...extra }) as unknown as GameEvent;

const events = [
  ev("gm", "gm-event", [{ startUtc: "2026-10-07T02:00:00Z", endUtc: "2026-10-07T03:00:00Z" }, { startUtc: "2026-10-14T02:00:00Z", endUtc: "2026-10-14T03:00:00Z" }], { minLevel: 10 }),
  ev("claim", "deadline", [{ startUtc: "2026-10-08T12:59:00Z", endUtc: null }]),
];
const opts = { leadMinutes: 15, muted: [] as string[], timeZone: "Australia/Sydney" };
const at = (s: string) => Date.parse(s);

test("fires once, 15 minutes before a GM event window", () => {
  expect(remindersBetween(events, at("2026-10-07T01:44:00Z"), at("2026-10-07T01:44:30Z"), opts)).toEqual([]);
  const r = remindersBetween(events, at("2026-10-07T01:44:30Z"), at("2026-10-07T01:45:00Z"), opts);
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({ eventId: "gm", title: "gm starts in 15 min" });
  expect(r[0]!.body).toMatch(/Starts: .*Lv 10\+.*Talk to the GM/);
  expect(remindersBetween(events, at("2026-10-07T01:45:00Z"), at("2026-10-07T01:45:30Z"), opts)).toEqual([]);
});

test("deadlines warn a day ahead and 15 minutes ahead", () => {
  const day = remindersBetween(events, at("2026-10-07T12:58:50Z"), at("2026-10-07T12:59:10Z"), opts);
  expect(day.map((r) => r.title)).toEqual(["claim — 24 h left"]);
  const late = remindersBetween(events, at("2026-10-08T12:43:50Z"), at("2026-10-08T12:44:10Z"), opts);
  expect(late.map((r) => r.title)).toEqual(["claim — 15 min left"]);
});

test("muted events and things that happened while the app was closed stay quiet", () => {
  expect(remindersBetween(events, at("2026-10-07T01:44:30Z"), at("2026-10-07T01:45:00Z"), { ...opts, muted: ["gm"] })).toEqual([]);
  // App opened after the reminder moment: the window starts at "now", nothing old fires.
  expect(remindersBetween(events, at("2026-10-07T01:50:00Z"), at("2026-10-07T01:50:30Z"), opts)).toEqual([]);
});
