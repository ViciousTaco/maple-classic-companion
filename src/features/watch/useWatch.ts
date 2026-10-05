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
  session: null,
  read: null,
  feed: [],
  startedAt: null,
  start: async () => {},
  stop: () => {},
  toggle: async () => {},
  setSpot: () => {},
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
    // Ctrl+Alt+W works even while the game has focus (global shortcut registered by Rust).
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
