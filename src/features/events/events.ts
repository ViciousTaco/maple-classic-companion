import type { GameEvent } from "../../data/schema/pack";

// Event timing helpers (P7-T5/T8). All comparisons are on UTC instants; Sydney time is display only.

export type EventState = {
  event: GameEvent;
  status: "now" | "upcoming" | "ended";
  /** The instant that matters next: the end of the current window, or the start of the next one. */
  at: string | null;
  /** For deadlines/one-off moments (no end), `at` is the moment itself. */
  moment: boolean;
};

export function eventState(e: GameEvent, now: Date): EventState {
  const t = now.getTime();
  const windows = [...e.windows].sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  for (const w of windows) {
    const start = Date.parse(w.startUtc);
    const end = w.endUtc ? Date.parse(w.endUtc) : null;
    if (end === null) {
      if (start > t) return { event: e, status: "upcoming", at: w.startUtc, moment: true };
      continue;
    }
    if (t < start) return { event: e, status: "upcoming", at: w.startUtc, moment: false };
    if (t < end) return { event: e, status: "now", at: w.endUtc, moment: false };
  }
  const last = windows.at(-1);
  return { event: e, status: "ended", at: last ? (last.endUtc ?? last.startUtc) : null, moment: false };
}

/** Running now (soonest ending first) then upcoming (soonest first). */
export function endingSoon(events: GameEvent[], now: Date, horizonDays = 30): EventState[] {
  const limit = now.getTime() + horizonDays * 86_400_000;
  return events
    .map((e) => eventState(e, now))
    .filter((s) => s.status !== "ended" && s.at !== null && Date.parse(s.at) <= limit)
    .sort((a, b) => (a.status === b.status ? Date.parse(a.at!) - Date.parse(b.at!) : a.status === "now" ? -1 : 1));
}

/** "3 d 4 h", "5 h 12 min", "12 min". */
export function countdown(to: string, now: Date): string {
  const ms = Date.parse(to) - now.getTime();
  if (ms <= 0) return "now";
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${Math.max(1, m)} min`;
}

export function stateLabel(s: EventState, now: Date): string {
  if (!s.at) return "";
  if (s.status === "now") return `Ends in ${countdown(s.at, now)}`;
  if (s.moment) return s.event.kind === "deadline" ? `Deadline in ${countdown(s.at, now)}` : `In ${countdown(s.at, now)}`;
  return `Starts in ${countdown(s.at, now)}`;
}
