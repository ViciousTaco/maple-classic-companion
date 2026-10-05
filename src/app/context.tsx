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

export function useRoute(): string {
  const [route, setRoute] = useState(currentHash);
  useEffect(() => {
    const on = () => setRoute(currentHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(path: string) {
  if (currentHash() !== path) window.location.hash = path;
}
