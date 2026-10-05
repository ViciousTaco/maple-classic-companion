import { useEffect, useRef } from "react";
import type { Pack } from "../../data/pack";
import type { Platform } from "../../platform/types";
import type { ProfileStore } from "../characters/store";
import { toast } from "../../ui/overlays";
import { SYDNEY } from "../../lib/sydney";
import { remindersBetween } from "./reminders";

// I-26: checks every 30 s; a Windows notification when the platform has one, plus the in-app pill.

const CHECK_MS = 30_000;

type Notifier = { notify?: (title: string, body: string) => Promise<unknown> };

export function useEventReminders(platform: Platform, store: ProfileStore, pack: Pack | null) {
  const last = useRef<number | null>(null);
  const fired = useRef(new Set<string>());
  useEffect(() => {
    if (!pack) return;
    last.current ??= Date.now();
    const run = () => {
      const now = Date.now();
      const from = last.current ?? now;
      last.current = now;
      const s = store.getState().file.settings;
      if (!s.reminders.enabled) return;
      const tz = s.timeZoneMode === "sydney" ? SYDNEY : undefined;
      for (const r of remindersBetween(pack.events, from, now, { leadMinutes: s.reminders.leadMinutes, muted: s.reminders.muted, timeZone: tz })) {
        if (fired.current.has(r.key)) continue;
        fired.current.add(r.key);
        toast({ message: r.title, durationMs: 15_000 });
        void (platform as Platform & Notifier).notify?.(r.title, r.body).catch(() => {});
      }
    };
    const t = setInterval(run, CHECK_MS);
    return () => clearInterval(t);
  }, [platform, store, pack]);
}
