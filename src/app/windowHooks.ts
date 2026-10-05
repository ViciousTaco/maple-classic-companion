import { useEffect } from "react";
import type { ProfileStore } from "../features/characters/store";
import type { Platform } from "../platform/types";

/**
 * Inside the exe: flush pending saves before the window closes (plan §8.2) and remember the
 * window's size/position in profiles.json (replaces the window-state plugin; §15).
 */
export function useDesktopWindow(platform: Platform, store: ProfileStore, enabled = true) {
  useEffect(() => {
    if (platform.kind !== "tauri" || !enabled) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      if (disposed) return;
      const win = getCurrentWindow();

      cleanups.push(
        await win.onCloseRequested(async () => {
          await store.getState().flush();
        }),
      );

      const remember = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            const [maximized, minimized, scale] = await Promise.all([win.isMaximized(), win.isMinimized(), win.scaleFactor()]);
            if (minimized) return;
            const prev = store.getState().file.settings.window;
            if (maximized) {
              if (prev && !prev.maximized) store.getState().updateSettings({ window: { ...prev, maximized: true } });
              return;
            }
            const [size, pos] = await Promise.all([win.innerSize(), win.outerPosition()]);
            const next = {
              width: Math.round(size.width / scale),
              height: Math.round(size.height / scale),
              x: Math.round(pos.x / scale),
              y: Math.round(pos.y / scale),
              maximized: false,
            };
            const same = prev && Object.entries(next).every(([k, v]) => prev[k as keyof typeof prev] === v);
            if (!same) store.getState().updateSettings({ window: next });
          } catch {
            // Geometry is a convenience; never let it disturb the app.
          }
        }, 600);
      };
      cleanups.push(await win.onResized(remember));
      cleanups.push(await win.onMoved(remember));
    });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      cleanups.forEach((c) => c());
    };
  }, [platform, store, enabled]);
}
