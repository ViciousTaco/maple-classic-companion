import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MotionConfig } from "motion/react";
import { AppProvider, useProfiles, type PackInfo } from "./app/context";
import { Backdrop, Shell } from "./app/Shell";
import { useDesktopWindow } from "./app/windowHooks";
import { baselineRules, rulesFromPack } from "./data/gameRules";
import type { LoadResult } from "./data/pack";
import { loadActivePack } from "./data/updateClient";
import { appVersionOf, CHECK_EVERY_MS, makeFeedFetch, runUpdateCheck, useUpdates } from "./app/updates";
import { makeFetcher, newsDeps, useNews } from "./features/news/store";
import { createProfileStore, type ProfileStore } from "./features/characters/store";
import { platform as defaultPlatform } from "./platform/ipc";
import type { Platform } from "./platform/types";
import { toast, Toaster } from "./ui/overlays";
import { useWatcherSetup } from "./features/watch/useWatch";
import { useEventReminders } from "./features/events/useReminders";

function Loading() {
  return (
    <div className="flex h-full items-center justify-center" aria-busy="true">
      <div className="glass h-24 w-72 animate-pulse rounded-[28px]" />
    </div>
  );
}

const darkQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const subscribeDark = (cb: () => void) => {
  darkQuery?.addEventListener("change", cb);
  return () => darkQuery?.removeEventListener("change", cb);
};

/** Applies Settings → Theme / Animations to <html> and to Motion. */
function Appearance({ children }: { children: React.ReactNode }) {
  const theme = useProfiles((s) => s.file.settings.theme);
  const motion = useProfiles((s) => s.file.settings.motion);
  const systemDark = useSyncExternalStore(subscribeDark, () => darkQuery?.matches ?? false, () => false);
  const night = theme === "night" || (theme === "system" && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = night ? "night" : "day";
    document.documentElement.dataset.motion = motion;
  }, [night, motion]);
  return <MotionConfig reducedMotion={motion === "reduced" ? "always" : motion === "full" ? "never" : "user"}>{children}</MotionConfig>;
}

function Body({ packLoading }: { packLoading: boolean }) {
  const status = useProfiles((s) => s.status);
  return status === "loading" || packLoading ? <Loading /> : <Shell />;
}

export default function App({
  platform = defaultPlatform,
  store: injected,
  packLoader,
  liveUpdates = true,
}: {
  platform?: Platform;
  store?: ProfileStore;
  packLoader?: () => Promise<LoadResult>;
  /** News + guide-data + app update checks (off in tests). */
  liveUpdates?: boolean;
}) {
  const [store] = useState(() => injected ?? createProfileStore(platform));
  const [loaded, setLoaded] = useState<LoadResult | null>(null);
  useEffect(() => {
    void store.getState().load();
  }, [store]);
  useEffect(() => {
    let live = true;
    (packLoader ?? (() => loadActivePack(platform)))()
      .then((r) => live && setLoaded(r))
      .catch((err) => live && setLoaded({ ok: false, problems: [String(err)] }));
    return () => {
      live = false;
    };
  }, [packLoader, platform]);

  // Live updates: news + guide data + app version, on launch and every 30 minutes (plan §7.2).
  const started = useRef(false);
  const fromRef = useRef<"installed" | "bundled">("bundled");
  useEffect(() => {
    if (loaded?.ok) fromRef.current = loaded.from;
  }, [loaded]);
  const loadedOk = loaded?.ok === true;
  useEffect(() => {
    if (!liveUpdates || !loadedOk || started.current) return;
    started.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      const version = await appVersionOf(platform);
      void useNews.getState().start(newsDeps(platform, await makeFetcher(platform), version));
      const fetchFn = await makeFeedFetch(platform);
      const run = () =>
        runUpdateCheck({
          platform,
          fetchFn,
          appVersion: version,
          from: fromRef.current,
          onInstalled: (pack, v) => {
            setLoaded({ ok: true, pack, from: "installed", fellBack: null });
            toast({ message: `Guide data updated to ${v}` });
          },
        });
      useUpdates.getState().setStatus({ checkNow: () => void run() });
      await run();
      timer = setInterval(() => {
        void run();
        void useNews.getState().refresh();
      }, CHECK_EVERY_MS);
    })();
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [liveUpdates, loadedOk, platform]);
  useDesktopWindow(platform, store);

  const value = useMemo(() => {
    const pack = loaded?.ok ? loaded.pack : null;
    const packInfo: PackInfo = loaded?.ok
      ? { status: "ready", from: loaded.from, fellBack: loaded.fellBack }
      : { status: "failed", problems: loaded?.problems ?? [] };
    return { platform, store, pack, packInfo, rules: pack ? rulesFromPack(pack) : baselineRules };
  }, [platform, store, loaded]);
  useWatcherSetup(platform, store, value.pack);
  useEventReminders(platform, store, liveUpdates ? value.pack : null);

  return (
    <AppProvider value={value}>
      <Appearance>
        <Backdrop />
        <Body packLoading={loaded === null} />
        <Toaster />
      </Appearance>
    </AppProvider>
  );
}
