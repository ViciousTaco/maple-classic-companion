import { Bell, BellOff } from "lucide-react";
import { useProfileStore, useProfiles } from "../../app/context";

/** Per-event reminder switch (I-26). Hidden when reminders are off in Settings. */
export function ReminderBell({ eventId, title }: { eventId: string; title: string }) {
  const store = useProfileStore();
  const r = useProfiles((s) => s.file.settings.reminders);
  if (!r.enabled) return null;
  const muted = r.muted.includes(eventId);
  return (
    <button
      type="button"
      onClick={() => store.getState().updateSettings({ reminders: { ...r, muted: muted ? r.muted.filter((m) => m !== eventId) : [...r.muted, eventId] } })}
      aria-pressed={!muted}
      aria-label={muted ? `Remind me about ${title}` : `Stop reminders for ${title}`}
      title={muted ? "Reminders off for this event — click to turn on" : `Reminder ${r.leadMinutes} min before — click to turn off`}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${muted ? "bg-fill text-ink-3 hover:bg-fill-strong" : "bg-sky/15 text-sky hover:bg-sky/25"}`}
    >
      {muted ? <BellOff size={14} /> : <Bell size={14} />}
    </button>
  );
}
