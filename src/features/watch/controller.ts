import { createStore, type StoreApi } from "zustand/vanilla";
import type { Pack } from "../../data/pack";
import type { Profile, Settings } from "../../data/schema/profile";
import type { ProfileStore } from "../characters/store";
import { activeProfile } from "../characters/store";
import { recommendTraining } from "../../engine/recommend";
import { newLines, parseChatLine, parseStatus, type ChatEvent } from "./parse";
import { applyEvents, applyStatus, mergeSession, newSession, percentGained, tick, type SessionTotals } from "./session";

// I-29 screen watcher. The owner is always in control: it is off at every launch, only the owner turns it on
// (button, the top-bar pill or Ctrl+Alt+W), and it switches itself OFF — never on — when the game goes away
// or nothing has happened for a while. Frames stay in Rust memory; only recognised text reaches this module.

export type WatchWindow = { id: number; title: string; app: string; width: number; height: number; minimized: boolean };
export type WatchRegion = { name: string; x: number; y: number; w: number; h: number; scale?: number };
export type WatchLine = { text: string; x: number; y: number; w: number; h: number };

/** The platform calls the watcher needs (implemented in Rust, see src-tauri/src/screen.rs). */
export type WatchPlatform = {
  screenListWindows(): Promise<WatchWindow[]>;
  screenRead(windowId: number, regions: WatchRegion[]): Promise<{ name: string; lines: WatchLine[] }[]>;
};

export type WatchSetup = NonNullable<Settings["watch"]>;
export type FeedItem = { id: number; at: number; text: string };

export type WatchState = {
  status: "off" | "on" | "paused";
  /** Why it's paused or why it switched itself off. */
  problem: string | null;
  spotId: string | null;
  session: SessionTotals | null;
  read: { level: number | null; expPercent: number | null; at: number } | null;
  feed: FeedItem[];
  startedAt: number | null;

  start(spotId?: string | null): Promise<void>;
  stop(reason?: string): void;
  toggle(): Promise<void>;
  setSpot(spotId: string): void;
  /** One read cycle (the loop calls this; tests call it directly). */
  step(): Promise<void>;
};

export type WatcherDeps = {
  platform: WatchPlatform;
  store: ProfileStore;
  getPack: () => Pack | null;
  now?: () => number;
  /** Loop timer; tests pass a no-op and drive `step()` themselves. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Toast / banner for things the owner should know (auto-stop, level-up). */
  tell?: (message: string, tone?: "info" | "error") => void;
};

/** Switch off after this long without the game window (minimised/closed) or without any kill. */
export const AUTO_OFF_NO_WINDOW_MS = 5 * 60_000;
export const AUTO_OFF_IDLE_MS = 20 * 60_000;
/** Fold totals into the character every few minutes so a crash loses little. */
export const CHECKPOINT_MS = 5 * 60_000;
const FEED_MAX = 8;

export function describeEvent(e: ChatEvent, pack: Pack | null, mobId?: string): string {
  if (e.kind === "exp") {
    const mob = mobId && mobId !== "?" ? pack?.index.monsterById.get(mobId)?.name : undefined;
    return `+${e.amount.toLocaleString("en-AU")} EXP${mob ? ` · ${mob}` : ""}`;
  }
  if (e.kind === "meso") return `+${e.amount.toLocaleString("en-AU")} meso`;
  return `Picked up ${e.name}`;
}

export function createWatcher(deps: WatcherDeps): StoreApi<WatchState> {
  const now = deps.now ?? (() => Date.now());
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    });
  const tell = deps.tell ?? (() => {});

  let cancel: (() => void) | null = null;
  let prevChat: string[] | null = null;
  let lastStepAt = 0;
  let lastCheckpoint = 0;
  let missingSince: number | null = null;
  let levelVotes: number[] = [];
  let lastExpSync = 0;
  let countedRun = false;
  let runPct = 0;
  let runPctMs = 0;
  let feedId = 1;

  const profile = (): Profile | null => activeProfile(deps.store.getState());
  const setup = (): WatchSetup | null => deps.store.getState().file.settings.watch;

  return createStore<WatchState>()((set, get) => {
    const fold = (final: boolean) => {
      const s = get().session;
      const p = profile();
      if (!s || !p) return;
      const t = new Date(now());
      const pct = percentGained(s);
      if (pct !== null) {
        runPct += pct;
        runPctMs += s.activeMs;
      }
      const pace =
        final && runPctMs >= 10 * 60_000 && runPct > 0 && s.lastLevel !== null
          ? { percentPerHour: (runPct / runPctMs) * 3_600_000, level: s.lastLevel, measuredAt: t.toISOString(), minutes: runPctMs / 60_000 }
          : null;
      deps.store.getState().updateProfile(p.id, (prof) => ({
        ...prof,
        observations: mergeSession(prof.observations, s, t, !countedRun),
        // Auto pace (I-20): measured over this watching run, so the Plan screen's projection uses real numbers.
        ...(pace ? { pace } : {}),
      }));
      if (s.kills > 0) countedRun = true;
      // Continue counting from here with fresh totals (status start = last read).
      const fresh = newSession(s.spotId, s.mapId, t);
      set({ session: { ...fresh, lastKillAt: s.lastKillAt, startLevel: s.lastLevel, startExp: s.lastExp, lastLevel: s.lastLevel, lastExp: s.lastExp } });
    };

    const loop = () => {
      cancel = schedule(async () => {
        if (get().status === "off") return;
        await get().step();
        if (get().status !== "off") loop();
      }, (setup()?.intervalSec ?? 2) * 1000);
    };

    const findWindow = async (s: WatchSetup): Promise<WatchWindow | null> => {
      const wins = await deps.platform.screenListWindows();
      return wins.find((w) => w.title === s.windowTitle) ?? wins.find((w) => w.title.toLowerCase().includes(s.windowTitle.toLowerCase())) ?? null;
    };

    const syncLevel = (level: number | null, expPercent: number | null) => {
      const p = profile();
      if (!p || level === null) return;
      levelVotes = [...levelVotes, level].slice(-3);
      const cap = deps.getPack()?.meta.levelCap ?? 300;
      const stable = levelVotes.length === 3 && levelVotes.every((v) => v === level);
      if (stable && level !== p.level && level >= 1 && level <= cap) {
        deps.store.getState().updateProfile(p.id, (prof) => ({ ...prof, level, expPercent: expPercent ?? prof.expPercent }));
        lastExpSync = now();
        tell(level > p.level ? `Level ${level}! Your character is updated.` : `Level set to ${level} from the game screen.`);
      } else if (stable && level === p.level && expPercent !== null && now() - lastExpSync >= 60_000) {
        lastExpSync = now();
        if (p.expPercent === null || Math.abs(p.expPercent - expPercent) >= 0.01)
          deps.store.getState().updateProfile(p.id, (prof) => ({ ...prof, expPercent }));
      }
    };

    return {
      status: "off",
      problem: null,
      spotId: null,
      session: null,
      read: null,
      feed: [],
      startedAt: null,

      async start(spotId) {
        if (get().status !== "off") return;
        const s = setup();
        const p = profile();
        const pack = deps.getPack();
        if (!s || !p) {
          set({ problem: !s ? "Set up the watcher first: pick the game window and draw the two boxes." : "Pick a character first." });
          return;
        }
        const chosen = spotId ?? (pack ? recommendTraining({ profile: p, pack, now: new Date(now()) }).primary?.spotId : null) ?? null;
        const mapId = chosen ? (pack?.index.spotById.get(chosen)?.mapId ?? null) : null;
        prevChat = null;
        levelVotes = [];
        missingSince = null;
        countedRun = false;
        runPct = runPctMs = 0;
        lastStepAt = lastCheckpoint = now();
        set({ status: "on", problem: null, spotId: chosen, session: newSession(chosen, mapId, new Date(now())), read: null, feed: [], startedAt: now() });
        loop();
      },

      stop(reason) {
        if (get().status === "off") return;
        cancel?.();
        cancel = null;
        fold(true);
        set({ status: "off", problem: reason ?? null, session: null, startedAt: null });
        if (reason) tell(reason, "info");
      },

      async toggle() {
        if (get().status === "off") await get().start();
        else get().stop();
      },

      setSpot(spotId) {
        if (get().status === "off") {
          set({ spotId });
          return;
        }
        fold(false);
        countedRun = false;
        const mapId = deps.getPack()?.index.spotById.get(spotId)?.mapId ?? null;
        set({ spotId, session: { ...get().session!, spotId, mapId } });
      },

      async step() {
        const s = setup();
        const pack = deps.getPack();
        if (get().status === "off" || !s || !pack) return;
        const t = now();
        const dt = t - lastStepAt;
        lastStepAt = t;
        try {
          // Checked every read: the game may have been minimised, closed or resized since.
          const w = await findWindow(s);
          if (!w || w.minimized) throw new Missing(w ? "The game is minimised — watching pauses until it's back." : "Can't see the game window — is MapleStory open?");
          if (w.width !== s.sourceWidth || w.height !== s.sourceHeight)
            throw new Missing(`The game window changed size (${w.width}×${w.height}). Run the watcher setup again to redraw the boxes.`);
          const windowId = w.id;
          const regions: WatchRegion[] = [];
          if (s.status) regions.push({ name: "status", ...s.status });
          if (s.chat) regions.push({ name: "chat", ...s.chat });
          const out = await deps.platform.screenRead(windowId, regions);
          missingSince = null;
          if (get().status === "paused") set({ status: "on", problem: null });

          const statusLines = out.find((r) => r.name === "status")?.lines.map((l) => l.text) ?? [];
          const chatLines = out.find((r) => r.name === "chat")?.lines.map((l) => l.text) ?? [];
          const st = parseStatus(statusLines);
          // The first read only learns what's already in the chat box — nothing from before watching counts.
          const fresh = prevChat === null ? [] : newLines(prevChat, chatLines);
          prevChat = chatLines;
          const events = fresh.map(parseChatLine).filter((e): e is ChatEvent => e !== null);

          let session = get().session!;
          const before = { ...session.killsByMob };
          session = applyEvents(session, events, pack, t);
          session = tick(session, dt, t);
          session = applyStatus(session, st.level, st.expPercent);
          const feedNew: FeedItem[] = [];
          let mobIdx = 0;
          const newMobs = Object.entries(session.killsByMob).flatMap(([id, n]) => Array(n - (before[id] ?? 0)).fill(id) as string[]);
          for (const e of events) feedNew.push({ id: feedId++, at: t, text: describeEvent(e, pack, e.kind === "exp" ? newMobs[mobIdx++] : undefined) });
          set({
            session,
            read: st.level !== null || st.expPercent !== null ? { ...st, at: t } : get().read,
            feed: [...feedNew.reverse(), ...get().feed].slice(0, FEED_MAX),
          });
          syncLevel(st.level, st.expPercent);

          if (t - lastCheckpoint >= CHECKPOINT_MS) {
            lastCheckpoint = t;
            fold(false);
          }
          const lastKill = get().session?.lastKillAt ?? get().startedAt ?? t;
          if (t - lastKill >= AUTO_OFF_IDLE_MS) get().stop("No kills for 20 minutes, so the screen watcher switched itself off.");
        } catch (err) {
          missingSince ??= t;
          const message = err instanceof Missing ? err.message : `Couldn't read the game window: ${String(err)}`;
          set({ status: "paused", problem: message });
          if (t - missingSince >= AUTO_OFF_NO_WINDOW_MS) get().stop("The game window was gone for 5 minutes, so the screen watcher switched itself off.");
        }
      },
    };
  });
}

class Missing extends Error {}
