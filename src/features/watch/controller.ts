import { createStore, type StoreApi } from "zustand/vanilla";
import type { Pack } from "../../data/pack";
import type { Profile, Settings } from "../../data/schema/profile";
import type { ProfileStore } from "../characters/store";
import { jobLine, rulesFromPack } from "../../data/gameRules";
import { describeStats, parseSkillsWindow, parseStatsWindow, statsChanges, type Line, type StatsRead } from "./windows";
import { activeProfile } from "../characters/store";
import { recommendTraining } from "../../engine/recommend";
import { hiddenKills, matchName, newLines, parseChatLine, parseMapName, parseStatus, type ChatEvent } from "./parse";
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
  /** `covered`: another window overlapped the region, so its text must be ignored. */
  screenRead(windowId: number, regions: WatchRegion[]): Promise<{ name: string; lines: WatchLine[]; covered?: boolean }[]>;
};

export type WatchSetup = NonNullable<Settings["watch"]>;
export type FeedItem = { id: number; at: number; text: string };

export type WatchState = {
  status: "off" | "on" | "paused";
  /** Why it's paused or why it switched itself off. */
  problem: string | null;
  spotId: string | null;
  /** The map the minimap box says the player is on (null until read, or without a map box). */
  mapId: string | null;
  /** Following the minimap (default when a map box is set up). Picking a spot by hand switches it off for the run. */
  autoMap: boolean;
  session: SessionTotals | null;
  read: { level: number | null; expPercent: number | null; name: string | null; at: number } | null;
  feed: FeedItem[];
  startedAt: number | null;
  /** What the last whole-window read found (the in-game Stats / Skills windows), for the Watch screen. */
  lastScan: { at: number; stats: string | null; skills: number; applied: boolean } | null;

  start(spotId?: string | null): Promise<void>;
  stop(reason?: string): void;
  toggle(): Promise<void>;
  setSpot(spotId: string): void;
  /** Back to following the minimap. */
  followMap(): void;
  /** One read cycle (the loop calls this; tests call it directly). */
  step(): Promise<void>;
  /**
   * Read the whole game window once for the Stats / Skills windows and apply what's found (owner-initiated, works
   * while off). Returns what was applied, or why nothing was.
   */
  scanNow(): Promise<string>;
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
/** While on, the whole window is read this often for the Stats / Skills windows (cheaper regions every read). */
export const FULL_SCAN_EVERY_MS = 10_000;
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
  let prevStatus: { level: number | null; expValue: number | null } | null = null;
  /** Kills implied by the EXP total, held until the next read confirms the total didn't drop (a misread digit). */
  let pendingHidden: { kills: number; amount: number; expValue: number } | null = null;
  let nameMisses = 0;
  let lastFullScan = 0;
  /** A whole-window read must say the same thing twice before it changes the character (OCR noise). */
  let pendingScan: { key: string; stats: StatsRead | null; skills: Record<string, number> | null } | null = null;
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

    /** Spot for a map: the one in the current plan if it's there, else the first spot on that map, else none. */
    const spotOnMap = (pack: Pack, mapId: string): string | null => {
      const p = profile();
      const onMap = pack.trainingSpots.filter((sp) => sp.mapId === mapId).map((sp) => sp.id);
      if (onMap.length === 0) return null;
      if (p) {
        const plan = recommendTraining({ profile: p, pack, now: new Date(now()) });
        const hit = [plan.primary, ...plan.backups].find((r) => r && onMap.includes(r.spotId));
        if (hit) return hit.spotId;
      }
      return onMap[0]!;
    };

    /** The player moved to another map: bank what was counted so far and carry on there. */
    const moveTo = (pack: Pack, mapId: string, t: number) => {
      const cur = get().session;
      if (!cur || cur.mapId === mapId) return;
      fold(false);
      countedRun = false;
      const spotId = spotOnMap(pack, mapId);
      const name = pack.index.mapById.get(mapId)?.name ?? mapId;
      set({
        mapId,
        spotId,
        session: { ...get().session!, spotId, mapId },
        feed: [{ id: feedId++, at: t, text: spotId ? `Moved to ${name}` : `Moved to ${name} (no training spot in the guide yet — still counting)` }, ...get().feed].slice(0, FEED_MAX),
      });
    };

    /** Lines from a whole-window read → Stats / Skills windows → the character, once two reads agree. */
    const applyScan = (pack: Pack, lines: Line[], t: number, force = false): string => {
      const p = profile();
      if (!p) return "Pick a character first.";
      const line = jobLine(rulesFromPack(pack), p.jobId);
      line.add("beginner");
      const skillDefs = pack.skills.filter((sk) => line.has(sk.jobId)).map((sk) => ({ id: sk.id, name: sk.name, maxLevel: sk.maxLevel }));
      const stats = parseStatsWindow(lines);
      const skills = parseSkillsWindow(lines, skillDefs);
      const key = JSON.stringify([stats, skills]);
      const found = stats !== null || skills !== null;
      const agreed = force || (pendingScan?.key === key && found);
      pendingScan = found ? { key, stats, skills } : null;
      set({ lastScan: { at: t, stats: stats ? describeStats(stats) : null, skills: skills ? Object.keys(skills).length : 0, applied: false } });
      if (!found) return "No Stats or Skills window is open in the game right now — open one and try again.";
      if (!agreed) return "Read once — confirming on the next read.";
      const statChange = stats ? statsChanges(p, stats) : null;
      const skillChange = skills ? Object.fromEntries(Object.entries(skills).filter(([id, v]) => (p.skills[id] ?? 0) !== v)) : {};
      const skillCount = Object.keys(skillChange).length;
      if (!statChange && skillCount === 0) return "Already up to date with the game.";
      deps.store.getState().updateProfile(p.id, (prof) => ({
        ...prof,
        stats: { ...prof.stats, ...(statChange?.stats ?? {}) },
        combat: { ...prof.combat, ...(statChange?.combat ?? {}) },
        skills: { ...prof.skills, ...skillChange },
      }));
      const what = [statChange ? describeStats(statChange) : "", skillCount ? `${skillCount} skill level${skillCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
      set({ lastScan: { at: t, stats: stats ? describeStats(stats) : null, skills: skills ? Object.keys(skills).length : 0, applied: true }, feed: [{ id: feedId++, at: t, text: `Updated from the game: ${what}` }, ...get().feed].slice(0, FEED_MAX) });
      tell(`Character updated from the game: ${what}`);
      return `Updated: ${what}`;
    };

    return {
      status: "off",
      problem: null,
      spotId: null,
      mapId: null,
      autoMap: true,
      session: null,
      read: null,
      feed: [],
      startedAt: null,
      lastScan: null,

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
        prevStatus = null;
        pendingHidden = null;
        nameMisses = 0;
        pendingScan = null;
        lastFullScan = now();
        levelVotes = [];
        missingSince = null;
        countedRun = false;
        runPct = runPctMs = 0;
        lastStepAt = lastCheckpoint = now();
        set({ status: "on", problem: null, spotId: chosen, mapId, autoMap: !!s.map && spotId === undefined, session: newSession(chosen, mapId, new Date(now())), read: null, feed: [], startedAt: now() });
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
          set({ spotId, autoMap: false });
          return;
        }
        fold(false);
        countedRun = false;
        const mapId = deps.getPack()?.index.spotById.get(spotId)?.mapId ?? null;
        set({ spotId, mapId, autoMap: false, session: { ...get().session!, spotId, mapId } });
      },

      followMap() {
        set({ autoMap: true });
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
          if (s.map) regions.push({ name: "map", ...s.map });
          const fullScan = t - lastFullScan >= FULL_SCAN_EVERY_MS;
          if (fullScan) regions.push({ name: "full", x: 0, y: 0, w: s.sourceWidth, h: s.sourceHeight, scale: 1 });
          const out = await deps.platform.screenRead(windowId, regions);
          if (out.some((r) => r.covered)) throw new Missing("Something is covering the game's boxes (the mini window?) — move it aside and watching carries on.");
          missingSince = null;
          if (get().status === "paused") set({ status: "on", problem: null });

          const statusLines = out.find((r) => r.name === "status")?.lines.map((l) => l.text) ?? [];
          const chatLines = out.find((r) => r.name === "chat")?.lines.map((l) => l.text) ?? [];
          const fullLines = out.find((r) => r.name === "full")?.lines ?? [];
          // Without a minimap box, the minimap's title is still in the whole-window read (top-left corner).
          const mapLines =
            out.find((r) => r.name === "map")?.lines.map((l) => l.text) ??
            fullLines.filter((l) => l.y < s.sourceHeight * 0.25 && l.x < s.sourceWidth * 0.35).map((l) => l.text);
          const st = parseStatus(statusLines);

          // Right character? The status bar names it. Three clear mismatches in a row means another character
          // (or another client's window) is being read, and nothing from it may be counted.
          const me = profile();
          if (me && st.name) {
            nameMisses = matchName(st.name, [me.name]) ? 0 : nameMisses + 1;
            if (nameMisses >= 3)
              throw new Missing(`The game shows “${st.name}”, but this is ${me.name}'s profile. Switch character in the app (or pick the right game window) and watching carries on.`);
          }

          // Follow the player from map to map (minimap box).
          if (get().autoMap && mapLines.length > 0) {
            const mapName = parseMapName(mapLines, pack.maps.map((m) => m.name));
            const map = mapName ? pack.maps.find((m) => m.name === mapName) : undefined;
            if (map) moveTo(pack, map.id, t);
          }

          // The first read only learns what's already in the chat box — nothing from before watching counts.
          const fresh = prevChat === null ? [] : newLines(prevChat, chatLines);
          prevChat = chatLines;
          const events = fresh.map(parseChatLine).filter((e): e is ChatEvent => e !== null);

          // Kills the chat box can't show — identical lines (one monster type) or more kills than lines in one
          // interval (mobbing) — are implied by the rise in the EXP total that the chat didn't account for. They are
          // added only once the next read confirms the total didn't fall back (a misread digit would).
          if (pendingHidden) {
            if (st.expValue !== null && st.expValue >= pendingHidden.expValue)
              for (let i = 0; i < pendingHidden.kills; i++) events.unshift({ kind: "exp", amount: pendingHidden.amount });
            pendingHidden = null;
          }
          if (prevStatus && st.level !== null && st.level === prevStatus.level && st.expValue !== null && prevStatus.expValue !== null) {
            const counted = events.reduce((a, e) => (e.kind === "exp" ? a + e.amount : a), 0);
            const last = [...events].reverse().find((e) => e.kind === "exp") ?? [...chatLines].reverse().map(parseChatLine).find((e) => e?.kind === "exp");
            if (last?.kind === "exp") {
              const kills = hiddenKills(st.expValue - prevStatus.expValue - counted, last.amount);
              if (kills > 0) pendingHidden = { kills, amount: last.amount, expValue: st.expValue };
            }
          }
          if (st.expValue !== null || st.level !== null) prevStatus = { level: st.level ?? prevStatus?.level ?? null, expValue: st.expValue };

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
            read: st.level !== null || st.expPercent !== null ? { level: st.level, expPercent: st.expPercent, name: st.name, at: t } : get().read,
            feed: [...feedNew.reverse(), ...get().feed].slice(0, FEED_MAX),
          });
          syncLevel(st.level, st.expPercent);
          if (fullScan) {
            lastFullScan = t;
            applyScan(pack, fullLines, t);
          }

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

      async scanNow() {
        const s = setup();
        const pack = deps.getPack();
        if (!s) return "Set up the watcher first (it needs to know which window is the game).";
        if (!pack) return "The guide data isn't loaded.";
        try {
          const w = await findWindow(s);
          if (!w || w.minimized) return w ? "The game is minimised." : "Can't see the game window — is MapleStory open?";
          const out = await deps.platform.screenRead(w.id, [{ name: "full", x: 0, y: 0, w: w.width, h: w.height, scale: 1 }]);
          if (out[0]?.covered) return "Something is covering the game window — move it aside and try again.";
          return applyScan(pack, out[0]?.lines ?? [], now(), true);
        } catch (err) {
          return `Couldn't read the game window: ${String(err)}`;
        }
      },
    };
  });
}

class Missing extends Error {}
