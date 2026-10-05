import events from "../../../datapack/events.json";
import type { GameEvent } from "../../data/schema/pack";
import { countdown, endingSoon, eventState, stateLabel } from "./events";

const E = events as GameEvent[];
const byId = (id: string) => E.find((e) => e.id === id)!;

test("Founder's First Step: upcoming, then running, then ended", () => {
  const e = byId("founders-first-step");
  expect(eventState(e, new Date("2026-10-06T00:00:00Z")).status).toBe("upcoming");
  const running = eventState(e, new Date("2026-10-10T00:00:00Z"));
  expect(running).toMatchObject({ status: "now", at: "2026-10-20T23:59:00Z" });
  expect(eventState(e, new Date("2026-10-21T00:00:00Z")).status).toBe("ended");
});

test("multi-window GM events move to the next window", () => {
  const e = byId("gm-event-jump-quest");
  expect(eventState(e, new Date("2026-10-07T01:00:00Z"))).toMatchObject({ status: "now", at: "2026-10-07T02:00:00Z" });
  expect(eventState(e, new Date("2026-10-08T00:00:00Z"))).toMatchObject({ status: "upcoming", at: "2026-10-14T00:00:00Z" });
});

test("deadlines are moments", () => {
  const s = eventState(byId("founders-package-claim-deadline"), new Date("2026-11-27T22:00:00Z"));
  expect(s).toMatchObject({ status: "upcoming", moment: true });
  expect(stateLabel(s, new Date("2026-11-27T22:00:00Z"))).toBe("Deadline in 3 d 1 h");
});

test("endingSoon lists running events first", () => {
  const list = endingSoon(E, new Date("2026-10-07T01:00:00Z"));
  expect(list[0]!.event.id).toBe("gm-event-jump-quest");
  expect(list.every((s) => s.status !== "ended")).toBe(true);
  expect(list.find((s) => s.event.id === "founders-access-opens")).toBeUndefined(); // already happened
});

test("countdown formatting", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  expect(countdown("2026-10-10T04:30:00Z", now)).toBe("3 d 4 h");
  expect(countdown("2026-10-07T05:12:00Z", now)).toBe("5 h 12 min");
  expect(countdown("2026-10-07T00:00:20Z", now)).toBe("1 min");
  expect(countdown("2026-10-06T00:00:00Z", now)).toBe("now");
});
