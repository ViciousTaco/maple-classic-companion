import { useEffect, useSyncExternalStore } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { Pack } from "../../data/pack";
import type { Platform } from "../../platform/types";
import type { ProfileStore } from "../characters/store";
import { toast } from "../../ui/overlays";
import { createWatcher, type WatchPlatform, type WatchState } from "./controller";

// One watcher for the app, created by the main window only (single writer, §8.2).

const idle: StoreApi<WatchState> = createStore<WatchState>()(() => ({
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
  fields: { level: null, name: null, expPercent: null, expValue: null, map: null },
  run: { kills: 0, exp: 0, meso: 0, items: {}, activeMs: 0, pct: 0, pctMs: 0, maps: [] },
  lastSummary: null,
  effectiveIntervalMs: 2000,
  start: async () => {},
  stop: () => {},
  toggle: async () => {},
  setSpot: () => {},
  followMap: () => {},
  scanNow: async () => "Analyse works in the desktop app on Windows.",
  step: async () => {},
}));

let api: StoreApi<WatchState> = idle;
const listeners = new Set<() => void>();
const setApi = (next: StoreApi<WatchState>) => {
  api = next;
  listeners.forEach((f) => f());
};
const subscribeApi = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const packHolder = { current: null as Pack | null };

export type WatchCapablePlatform = Platform & WatchPlatform;

/** Whether this platform can watch the screen at all (the desktop app on Windows). */
export function canWatch(platform: Platform): platform is WatchCapablePlatform {
  const p = platform as Partial<WatchPlatform>;
  return typeof p.screenListWindows === "function" && typeof p.screenRead === "function";
}

export function useWatcherSetup(platform: Platform, store: ProfileStore, pack: Pack | null, enabled = true) {
  useEffect(() => {
    packHolder.current = pack;
  }, [pack]);
  useEffect(() => {
    if (!enabled || !canWatch(platform)) return;
    const w = createWatcher({ platform, store, getPack: () => packHolder.current, tell: (message, tone) => toast({ message, tone }) });
    setApi(w);
    // I-33: Rust registers the default key at launch; apply the owner's saved choice (once the save file is loaded).
    const hk = platform as Platform & { hotkeySet?: (a: string) => Promise<{ registered: boolean; accelerator: string }> };
    const applyHotkey = () => {
      const st = store.getState();
      if (st.status === "loading" || !hk.hotkeySet) return false;
      void hk.hotkeySet(st.file.settings.hotkey).catch(() => {});
      return true;
    };
    const unsubStore = applyHotkey() ? () => {} : store.subscribe(() => applyHotkey() && unsubStore());
    // The hotkey (default Ctrl+Shift+K) works even while the game has focus (global shortcut registered by Rust).
    const p = platform as Platform & { onEvent?: (name: string, fn: (payload: unknown) => void) => unknown };
    let un: (() => void) | null = null;
    let dead = false;
    void Promise.resolve(p.onEvent?.("mcc://watch-toggle", () => void w.getState().toggle())).then((u) => {
      if (typeof u !== "function") return;
      if (dead) (u as () => void)();
      else un = u as () => void;
    });
    return () => {
      dead = true;
      un?.();
      unsubStore();
      w.getState().stop();
      setApi(idle);
    };
  }, [platform, store, enabled]);
}

export function watcherApi(): StoreApi<WatchState> {
  return api;
}

export function useWatch<T>(selector: (s: WatchState) => T): T {
  const current = useSyncExternalStore(subscribeApi, () => api);
  return useStore(current, selector);
}
