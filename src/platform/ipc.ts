import { createMockPlatform } from "./ipc.mock";
import { tauriPlatform } from "./ipc.tauri";
import type { Platform } from "./types";

export type * from "./types";
export { APP_EVENTS, NEED_ALL_FILES, RELEASE_URL_PREFIX } from "./types";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Browser preview only: `?demo` starts the in-memory mock with a sample Lv 23 Thief (never used in the exe). */
function demoSave(): string | null {
  if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("demo")) return null;
  const t = "2026-10-06T00:00:00.000Z";
  return JSON.stringify({
    schemaVersion: 1,
    activeProfileId: "0b9f8a52-6a4e-4a39-9c55-2f1d1f7f0a11",
    profiles: [
      {
        id: "0b9f8a52-6a4e-4a39-9c55-2f1d1f7f0a11",
        name: "Demo",
        createdAt: t,
        updatedAt: t,
        jobId: "thief",
        level: 23,
        expPercent: 42,
        stats: { hp: 900, luk: 60, dex: 25 },
        combat: { damageMin: 40, damageMax: 90 },
      },
    ],
    settings: {},
  });
}

/** The real Rust bridge inside the exe; an in-memory mock in a plain browser or tests. */
export const platform: Platform = inTauri ? tauriPlatform : createMockPlatform(demoSave());
