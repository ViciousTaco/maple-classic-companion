import { createStore, type StoreApi } from "zustand/vanilla";
import type { Pack } from "../../data/pack";
import { TRAINING_LOG_MAX, type Profile, type Settings, type TrainingRun } from "../../data/schema/profile";
import type { ProfileStore } from "../characters/store";
import { jobLine, rulesFromPack } from "../../data/gameRules";
import { describeStats, parseQuestWindow, parseSkillsWindow, parseStatsWindow, plausibleStats, statsChanges, type Line, type QuestsRead, type StatsRead } from "./windows";
import { activeProfile } from "../characters/store";
import { recommendTraining } from "../../engine/recommend";
import { hiddenKills, matchName, newLines, parseChatLine, parseMapName, parseStatus, type ChatEvent } from "./parse";
import { applyEvents, applyStatus, mergeSession, newSession, observationKey, percentGained, tick, type SessionTotals } from "./session";

const addCounts = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
};

/** Appends a run, or merges it into the previous row when it continues the same stretch (a checkpoint). */
function appendRun(log: TrainingRun[], run: TrainingRun, continues: boolean): TrainingRun[] {
  const last = log.at(-1);
  if (continues && last && last.key === run.key && last.endedAt === run.startedAt) {
    const merged: TrainingRun = {
      ...last,
      endedAt: run.endedAt,
      level: run.level ?? last.level,
      minutes: last.minutes + run.minutes,
      kills: last.kills + run.kills,
      exp: last.exp + run.exp,
      meso: last.meso + run.meso,
      items: addCounts(last.items, run.items),
      levelPercent: last.levelPercent === null && run.levelPercent === null ? null : (last.levelPercent ?? 0) + (run.levelPercent ?? 0),
    };
    return [...log.slice(0, -1), merged];
  }
  return [...log, run].slice(-TRAINING_LOG_MAX);
}

// I-29 screen watcher. The owner is always in control: it is off at every launch, only the owner turns it on
// (button, the top-bar pill or the hotkey, default Ctrl+Shift+K), and it switches itself OFF — never on — when the game goes away
// or nothing has happened for a while. Frames stay in Rust memory; only recognised text reaches this module.

export type WatchWindow = { id: number; title: string; app: string; width: number; height: number; minimized: boolean };
export type WatchRegion = { name: string; x: number; y: number; w: number; h: number; scale?: number; filter?: "bilinear" | "nearest"; mode?: "ocr" | "bar" };
export type WatchLine = { text: string; x: number; y: number; w: number; h: number };

/** The platform calls the watcher needs (implemented in Rust, see src-tauri/src/screen.rs). */
export type WatchPlatform = {
  screenListWindows(): Promise<WatchWindow[]>;
  /** I-44 diagnostic log line (text only); optional so tests and the browser preview can omit it. */
  watchLogAppend?(line: string): Promise<string>;
  /** `covered`: another window overlapped the region, so its text must be ignored. */
  screenRead(windowId: number, regions: WatchRegion[]): Promise<{ name: string; lines: WatchLine[]; covered?: boolean; fill?: number | null }[]>;
};

export type WatchSetup = NonNullable<Settings["watch"]>;
export type RunTotals = { kills: number; exp: number; meso: number; items: Record<string, number>; activeMs: number; pct: number; pctMs: number; maps: string[] };
export type RunSummary = RunTotals & { startedAt: number; endedAt: number; level: number | null };
const EMPTY_RUN: RunTotals = { kills: 0, exp: 0, meso: 0, items: {}, activeMs: 0, pct: 0, pctMs: 0, maps: [] };
export type FeedItem = { id: number; at: number; text: string };

export type WatchState = {
  status: "off" | "on" | "paused";
  /** Why it's paused or why it switched itself off. */
  problem: string | null;
  spotId: string | null;
  /** The map the minimap box says the player is on (null until read, or without a map box). */
  mapId: string | null;
  /** What the minimap says right now, as read (the map's own name, matched to the guide or not). */
  mapText: string | null;
  /** Following the minimap (default when a map box is set up). Picking a spot by hand switches it off for the run. */
  autoMap: boolean;
  session: SessionTotals | null;
  read: { level: number | null; expPercent: number | null; name: string | null; at: number } | null;
  feed: FeedItem[];
  startedAt: number | null;
  /** What the last whole-window read found (the in-game Stats / Skills / Quest windows), for the Watch screen. */
  lastScan: { at: number; stats: string | null; skills: number; quests: number; applied: boolean } | null;
  /** Totals for the whole watching run so far (the session resets at checkpoints and map changes; this doesn't). */
  run: RunTotals;
  /** The last finished run, for the summary card. */
  lastSummary: RunSummary | null;
  /** I-32: the interval actually in use — grows when reads take longer than the chosen interval. */
  effectiveIntervalMs: number;

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
/**
 * While on, the whole window is read this often for the Stats / Skills windows (the small boxes are read every tick).
 * Once such a window is seen, the confirming read happens on the very next tick, so an update lands in 2–7 s.
 */
export const FULL_SCAN_EVERY_MS = 5_000;
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
  let confirmNext = false;
  /** A whole-window read must say the same thing twice before it changes the character (OCR noise). */
  let pendingScan: { key: string; stats: StatsRead | null; skills: Record<string, number> | null; quests: QuestsRead | null } | null = null;
  let lastStepMs = 0;
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
      const key = observationKey(s.spotId, s.mapId);
      // I-34: one training-log row per watched stretch at a map (checkpoints of the same stretch are merged).
      const run: TrainingRun | null =
        key && s.kills > 0
          ? { startedAt: s.startedAt, endedAt: t.toISOString(), key, level: s.lastLevel, minutes: s.activeMs / 60_000, kills: s.kills, exp: s.exp, meso: s.meso, items: s.items, levelPercent: pct }
          : null;
      deps.store.getState().updateProfile(p.id, (prof) => ({
        ...prof,
        observations: mergeSession(prof.observations, s, t, !countedRun),
        trainingLog: run ? appendRun(prof.trainingLog, run, countedRun) : prof.trainingLog,
        // Auto pace (I-20): measured over this watching run, so the Plan screen's projection uses real numbers.
        ...(pace ? { pace } : {}),
      }));
      const r = get().run;
      set({
        run: {
          kills: r.kills + s.kills,
          exp: r.exp + s.exp,
          meso: r.meso + s.meso,
          items: addCounts(r.items, s.items),
          activeMs: r.activeMs + s.activeMs,
          pct: r.pct + (pct ?? 0),
          pctMs: r.pctMs + (pct === null ? 0 : s.activeMs),
          maps: s.mapId && !r.maps.includes(s.mapId) && s.kills > 0 ? [...r.maps, s.mapId] : r.maps,
        },
      });
      if (s.kills > 0) countedRun = true;
      // Continue counting from here with fresh totals (status start = last read).
      const fresh = newSession(s.spotId, s.mapId, t);
      set({ session: { ...fresh, lastKillAt: s.lastKillAt, startLevel: s.lastLevel, startExp: s.lastExp, lastLevel: s.lastLevel, lastExp: s.lastExp } });
    };

    const loop = () => {
      // I-32: never schedule faster than reads can finish — a slow read stretches the next wait (×1.5 its duration).
      const wanted = (setup()?.intervalSec ?? 2) * 1000;
      const effective = Math.max(wanted, Math.round(lastStepMs * 1.5));
      if (effective !== get().effectiveIntervalMs) set({ effectiveIntervalMs: effective });
      cancel = schedule(async () => {
        if (get().status === "off") return;
        const t0 = now();
        await get().step();
        lastStepMs = now() - t0;
        if (get().status !== "off") loop();
      }, effective);
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
      // The character always shows what the screen says (owner's rule); the guide's cap only limits its advice.
      if (stable && level > cap && level !== p.level && !get().feed.some((f) => f.text.includes("guide's data stops at"))) {
        set({ feed: [{ id: feedId++, at: now(), text: `Game shows Lv ${level}. This guide's data stops at Lv ${cap}, so training advice ends there — the character is set to ${level} anyway.` }, ...get().feed].slice(0, FEED_MAX) });
      }
      if (stable && level !== p.level && level >= 1 && level <= 300) {
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
      const rawStats = parseStatsWindow(lines);
      const stats = rawStats && plausibleStats(rawStats, p.level) ? rawStats : null;
      const skills = parseSkillsWindow(lines, skillDefs);
      const quests = parseQuestWindow(lines, pack.quests.map((q) => ({ id: q.id, name: q.name })));
      const key = JSON.stringify([stats, skills, quests]);
      const found = stats !== null || skills !== null || quests !== null;
      const agreed = force || (pendingScan?.key === key && found);
      pendingScan = found ? { key, stats, skills, quests } : null;
      confirmNext = found && !agreed;
      const seen = { stats: stats ? describeStats(stats) : null, skills: skills ? Object.keys(skills).length : 0, quests: quests ? quests.active.length + quests.done.length : 0 };
      set({ lastScan: { at: t, ...seen, applied: false } });
      if (!found) return "No Stats, Skills or Quest window is open in the game right now — open one and try again.";
      if (!agreed) return "Read once — confirming on the next read.";
      const statChange = stats ? statsChanges(p, stats) : null;
      const skillChange = skills ? Object.fromEntries(Object.entries(skills).filter(([id, v]) => (p.skills[id] ?? 0) !== v)) : {};
      const skillCount = Object.keys(skillChange).length;
      // I-38: quests seen under "In Progress" become active; under "Completed" become done. Nothing is ever un-done.
      const newActive = quests ? quests.active.filter((id) => !p.unlocks.questsActive.includes(id) && !p.unlocks.questsDone.includes(id)) : [];
      const newDone = quests ? quests.done.filter((id) => !p.unlocks.questsDone.includes(id)) : [];
      const expChange = stats?.expPercent !== undefined && stats.expPercent !== p.expPercent ? stats.expPercent : null;
      if (!statChange && skillCount === 0 && newActive.length === 0 && newDone.length === 0 && expChange === null) return "Already up to date with the game.";
      deps.store.getState().updateProfile(p.id, (prof) => ({
        ...prof,
        ...(expChange !== null ? { expPercent: expChange } : {}),
        stats: { ...prof.stats, ...(statChange?.stats ?? {}) },
        combat: { ...prof.combat, ...(statChange?.combat ?? {}) },
        skills: { ...prof.skills, ...skillChange },
        unlocks: {
          ...prof.unlocks,
          questsActive: [...prof.unlocks.questsActive.filter((id) => !newDone.includes(id)), ...newActive],
          questsDone: [...prof.unlocks.questsDone, ...newDone],
        },
      }));
      const questWhat = [newActive.length ? `${newActive.length} quest${newActive.length === 1 ? "" : "s"} in progress` : "", newDone.length ? `${newDone.length} quest${newDone.length === 1 ? "" : "s"} completed` : ""].filter(Boolean).join(", ");
      const what = [statChange ? describeStats(statChange) : "", expChange !== null ? `EXP ${expChange}%` : "", skillCount ? `${skillCount} skill level${skillCount === 1 ? "" : "s"}` : "", questWhat].filter(Boolean).join(" · ");
      set({ lastScan: { at: t, ...seen, applied: true }, feed: [{ id: feedId++, at: t, text: `Updated from the game: ${what}` }, ...get().feed].slice(0, FEED_MAX) });
      tell(`Character updated from the game: ${what}`);
      return `Updated: ${what}`;
    };

    return {
      status: "off",
      problem: null,
      spotId: null,
      mapId: null,
      mapText: null,
      autoMap: true,
      session: null,
      read: null,
      feed: [],
      startedAt: null,
      lastScan: null,
      run: EMPTY_RUN,
      lastSummary: null,
      effectiveIntervalMs: 2000,

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
        confirmNext = false;
        lastFullScan = now();
        lastStepMs = 0;
        levelVotes = [];
        missingSince = null;
        countedRun = false;
        runPct = runPctMs = 0;
        lastStepAt = lastCheckpoint = now();
        set({ status: "on", problem: null, spotId: chosen, mapId, autoMap: !!s.map && spotId === undefined, session: newSession(chosen, mapId, new Date(now())), read: null, feed: [], startedAt: now(), run: EMPTY_RUN });
        loop();
      },

      stop(reason) {
        if (get().status === "off") return;
        cancel?.();
        cancel = null;
        const level = get().session?.lastLevel ?? null;
        fold(true);
        const r = get().run;
        const summary: RunSummary | null = r.kills > 0 ? { ...r, startedAt: get().startedAt ?? now(), endedAt: now(), level } : null;
        set({ status: "off", problem: reason ?? null, session: null, startedAt: null, lastSummary: summary ?? get().lastSummary });
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
          // Game text is small: enlarge 3× before OCR. "pixel" keeps bitmap fonts crisp (no smoothing).
          const filter = s.textStyle === "pixel" ? "nearest" : "bilinear";
          if (s.status) regions.push({ name: "status", ...s.status, scale: 3, filter });
          if (s.chat) regions.push({ name: "chat", ...s.chat, scale: 3, filter });
          if (s.map) regions.push({ name: "map", ...s.map, scale: 3, filter });
          if (s.expBar) regions.push({ name: "expBar", ...s.expBar, mode: "bar" });
          const fullScan = confirmNext || t - lastFullScan >= FULL_SCAN_EVERY_MS;
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
          // I-45: when the bar's digits can't be read, its fill is the EXP % (to 0.1 %, good enough for pace).
          const fill = out.find((r) => r.name === "expBar")?.fill;
          if (st.expPercent === null && typeof fill === "number" && fill >= 0 && fill <= 1) st.expPercent = Math.round(fill * 1000) / 10;

          // Right character? The status bar names it. Three clear mismatches in a row means another character
          // (or another client's window) is being read, and nothing from it may be counted.
          const me = profile();
          if (me && st.name) {
            const anywhere = statusLines.some((l) => l.split(/\s+/).some((w) => matchName(w, [me.name])));
            nameMisses = anywhere || matchName(st.name, [me.name]) ? 0 : nameMisses + 1;
            if (nameMisses >= 3)
              throw new Missing(`The game shows “${st.name}”, but this is ${me.name}'s profile. Switch character in the app (or pick the right game window) and watching carries on.`);
          }

          // Follow the player from map to map (minimap box).
          if (get().autoMap && mapLines.length > 0) {
            const mapName = parseMapName(mapLines, pack.maps.map((m) => m.name));
            const map = mapName ? pack.maps.find((m) => m.name === mapName) : undefined;
            // Live "current map": the guide's name when matched, else the minimap's own text (map line only — the
            // area name is usually the first line and the channel is dropped).
            const cleaned = mapLines.map((l) => l.replace(/\b(?:ch|channel)\.?\s*\d+\b/i, "").trim()).filter((l) => l.length >= 3);
            const text = map ? map.name : (cleaned.at(-1) ?? null);
            if (map) moveTo(pack, map.id, t);
            if (text !== get().mapText) set({ mapText: text });
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
          // The EXP bar moving up is training even when no chat line could be read (owner's run on the live
          // client): it keeps the training clock running so pace and time-to-level come from the bar alone.
          const prevExp = session.lastExp;
          if (st.expPercent !== null && prevExp !== null && st.expPercent > prevExp + 0.001 && (st.level === null || st.level === (session.lastLevel ?? st.level))) session = { ...session, lastKillAt: t };
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
          // I-44: diagnostic log — recognised text and decisions, never pixels; only while the owner has it on.
          if (s.diagnostics && deps.platform.watchLogAppend) {
            const sess = get().session!;
            void deps.platform
              .watchLogAppend(
                JSON.stringify({
                  t: new Date(t).toISOString(),
                  ms: lastStepMs,
                  status: statusLines,
                  chat: chatLines,
                  map: mapLines,
                  full: fullScan ? fullLines.map((l) => l.text) : undefined,
                  parsed: { level: st.level, expPercent: st.expPercent, expValue: st.expValue, name: st.name, mapId: get().mapId },
                  fresh,
                  events,
                  hiddenPending: pendingHidden?.kills ?? 0,
                  session: { kills: sess.kills, exp: sess.exp, meso: sess.meso, activeMs: sess.activeMs, spotId: sess.spotId },
                  scan: fullScan ? get().lastScan : undefined,
                }),
              )
              .catch(() => {});
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
