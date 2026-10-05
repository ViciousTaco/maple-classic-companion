import { createMockPlatform } from "./ipc.mock";
import { tauriPlatform } from "./ipc.tauri";
import type { Platform } from "./types";

export type * from "./types";
export { NEED_ALL_FILES, RELEASE_URL_PREFIX } from "./types";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** The real Rust bridge inside the exe; an in-memory mock in a plain browser or tests. */
export const platform: Platform = inTauri ? tauriPlatform : createMockPlatform();
