import type { GameEvent } from "../../data/schema/pack";
import { formatWhen } from "../../lib/sydney";

// I-26: reminders shortly before an event starts or a deadline passes. Only reminders whose moment falls between
// two checks fire, so nothing fires late for things that happened while the app was closed.

export type Reminder = { key: string; eventId: string; title: string; body: string; at: string };

/** Deadlines also get a day's warning. */
const DEADLINE_EARLY_MS = 24 * 3_600_000;

export function remindersBetween(
  events: GameEvent[],
  fromMs: number,
  toMs: number,
  opts: { leadMinutes: number; muted: string[]; timeZone?: string },
): Reminder[] {
  const muted = new Set(opts.muted);
  const lead = opts.leadMinutes * 60_000;
  const out: Reminder[] = [];
  for (const e of events) {
    if (muted.has(e.id)) continue;
    for (const w of e.windows) {
      const at = Date.parse(w.startUtc);
      const deadline = e.kind === "deadline" || (w.endUtc === null && e.kind !== "event");
      const leads = deadline ? [lead, DEADLINE_EARLY_MS] : [lead];
      for (const l of leads) {
        const fire = at - l;
        if (fire <= fromMs || fire > toMs) continue;
        const when = formatWhen(w.startUtc, opts.timeZone);
        const inText = l >= 3_600_000 ? `${Math.round(l / 3_600_000)} h` : `${Math.round(l / 60_000)} min`;
        out.push({
          key: `${e.id}@${w.startUtc}#${l}`,
          eventId: e.id,
          title: deadline ? `${e.title} — ${inText} left` : `${e.title} starts in ${inText}`,
          body: [`${deadline ? "Deadline" : "Starts"}: ${when}`, e.minLevel ? `Lv ${e.minLevel}+` : "", e.howTo].filter(Boolean).join(" · ").slice(0, 240),
          at: w.startUtc,
        });
      }
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
