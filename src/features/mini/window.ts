import { useEffect, useRef } from "react";
import type { Pack } from "../../data/pack";
import type { Platform } from "../../platform/types";
import type { ProfileStore } from "../characters/store";
import { watcherApi } from "../watch/useWatch";
import { parseMiniAction, profileChange } from "./actions";

// I-24 plumbing. Which window is this, the main window applying mini actions, and the mini window reloading.

type Events = { onEvent?: (name: string, fn: (payload: unknown) => void) => unknown };

/** "mini" for the mini window (or `?mini` in a browser preview), otherwise "main". */
export function windowLabel(): "main" | "mini" {
  if (typeof window === "undefined") return "main";
  const meta = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__;
  if (meta) return meta.metadata?.currentWindow?.label === "mini" ? "mini" : "main";
  return new URLSearchParams(window.location.search).has("mini") ? "mini" : "main";
}

/** A platform for the mini window: same reads, but it can never write the save file. */
export function readOnlyPlatform(platform: Platform): Platform {
  return { ...platform, profilesSave: async () => {} };
}

function useEvent(platform: Platform, name: string, enabled: boolean, handler: (payload: unknown) => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const on = (platform as Platform & Events).onEvent;
    if (!enabled || !on) return;
    let un: (() => void) | null = null;
    let dead = false;
    void Promise.resolve(on(name, (payload) => latest.current(payload))).then((u) => {
      if (typeof u !== "function") return;
      if (dead) (u as () => void)();
      else un = u as () => void;
    });
    return () => {
      dead = true;
      un?.();
    };
  }, [platform, name, enabled]);
}

/** Main window: apply what the mini window asks for. */
export function useMiniActions(platform: Platform, store: ProfileStore, pack: Pack | null, enabled: boolean) {
  useEvent(platform, "mcc://mini-action", enabled, (raw) => {
    const a = parseMiniAction(raw);
    if (!a) return;
    if (a.kind === "watch-toggle") {
      void watcherApi().getState().toggle();
      return;
    }
    const change = profileChange(a, pack, new Date());
    if (change) store.getState().updateProfile(a.payload.profileId, change);
  });
}

/** Mini window: reload whenever the main window saved. */
export function useReloadOnSave(platform: Platform, store: ProfileStore, enabled: boolean) {
  useEvent(platform, "mcc://profiles-saved", enabled, () => void store.getState().load());
}
