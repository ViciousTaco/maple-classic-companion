import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { Platform } from "../platform/types";
import { activeProfile, type ProfileStore, type ProfilesState } from "../features/characters/store";
import { baselineRules, type GameRules } from "../data/gameRules";
import type { Pack } from "../data/pack";

export type PackInfo =
  | { status: "ready"; from: "installed" | "bundled"; fellBack: { from: string; problem: string } | null }
  | { status: "failed"; problems: string[] };

type AppCtx = { platform: Platform; store: ProfileStore; rules: GameRules; pack: Pack | null; packInfo: PackInfo };

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ value, children }: { value: AppCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useCtx(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppProvider missing");
  return c;
}

export const usePlatform = () => useCtx().platform;
export const useRules = (): GameRules => useContext(Ctx)?.rules ?? baselineRules;
export const useProfileStore = () => useCtx().store;
export const usePack = () => useCtx().pack;
export const usePackInfo = () => useCtx().packInfo;

export function useProfiles<T>(selector: (s: ProfilesState) => T): T {
  return useStore(useCtx().store, selector);
}

export const useActiveProfile = () => useProfiles(activeProfile);

// ---- Hash routing (plan §9.1) ----

function currentHash(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h.startsWith("/") ? h : "/home";
}

function useHash(): string {
  const [hash, setHash] = useState(currentHash);
  useEffect(() => {
    const on = () => setHash(currentHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

/** The current screen path, without any `?query`. */
export function useRoute(): string {
  return useHash().split("?")[0]!;
}

/** `?q=…` etc. from the current hash (search results open screens pre-filtered). */
export function useRouteQuery(): URLSearchParams {
  const hash = useHash();
  return new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");
}

export function navigate(path: string) {
  if (currentHash() !== path) window.location.hash = path;
}
