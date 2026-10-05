import { useEffect, useState, type ReactNode } from "react";
import { toast } from "../ui/overlays";
import { motion } from "motion/react";
import { ChartSpline, Gem, Home as HomeIcon, Leaf, Newspaper, NotebookPen, ScrollText, Settings, Shield, Swords, Users } from "lucide-react";
import { jobName } from "../data/gameRules";
import { CharacterSheet } from "../features/characters/CharacterSheet";
import { CharactersScreen, Portrait } from "../features/characters/CharactersScreen";
import { Wizard } from "../features/characters/Wizard";
import { QuickNoteDialog, useQuickNote } from "../features/notes/QuickNote";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { TrainScreen } from "../features/train/TrainScreen";
import { HomeScreen } from "../features/home/HomeScreen";
import { LootScreen } from "../features/loot/LootScreen";
import { GearScreen } from "../features/gear/GearScreen";
import { QuestsScreen } from "../features/quests/QuestsScreen";
import { ProjectionsScreen } from "../features/projections/ProjectionsScreen";
import { formatWhen } from "../lib/sydney";
import { Button, IconButton, LargeTitle, Stepper, spring } from "../ui/kit";
import { navigate, useActiveProfile, usePack, usePackInfo, usePlatform, useProfileStore, useProfiles, useRoute, useRules } from "./context";
import { useUpdates } from "./updates";
import { useNews } from "../features/news/store";
import { NewsScreen } from "../features/news/NewsScreen";
import { MapsScreen } from "../features/maps/MapsScreen";
import { LevelUpBurst } from "../ui/LevelUpBurst";
import { relativeTime } from "../features/characters/hooks";
import { useNow } from "../features/guide/parts";

const NAV = [
  { path: "/home", label: "Home", Icon: HomeIcon },
  { path: "/train", label: "Train", Icon: Swords },
  { path: "/plan", label: "Plan", Icon: ChartSpline },
  { path: "/loot", label: "Loot", Icon: Gem },
  { path: "/gear", label: "Gear", Icon: Shield },
  { path: "/quests", label: "Quests", Icon: ScrollText },
  { path: "/news", label: "News", Icon: Newspaper },
  { path: "/characters", label: "Characters", Icon: Users },
] as const;

export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden>
      <i />
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

function NoticeBar() {
  const notice = useProfiles((s) => s.notice);
  const saveError = useProfiles((s) => s.saveError);
  const dismiss = useProfileStore().getState().dismissNotice;
  const packInfo = usePackInfo();
  const pack = usePack();
  const platform = usePlatform();
  const store = useProfileStore();
  const appRelease = useUpdates((s) => s.appRelease);
  const news = useNews((s) => s.result);
  const [updating, setUpdating] = useState(false);
  const messages: { text: ReactNode; tone: "warn" | "error" | "info"; dismissable: boolean }[] = [];
  if (appRelease)
    messages.push({
      tone: "info",
      dismissable: false,
      text: (
        <span className="flex flex-wrap items-center gap-3">
          <span>
            <strong>Version {appRelease.version} is ready.</strong> {appRelease.notes}
          </span>
          <Button
            size="sm"
            variant="primary"
            disabled={updating}
            onClick={async () => {
              setUpdating(true);
              try {
                await store.getState().flush();
                await platform.appUpdateApply(appRelease.url, appRelease.sha256, appRelease.signature);
              } catch (err) {
                setUpdating(false);
                toast({ message: `Update failed: ${String(err)}`, tone: "error" });
              }
            }}
          >
            {updating ? "Updating…" : "Update & restart"}
          </Button>
        </span>
      ),
    });
  // P7-T7: Nexon posted an update the guide data hasn't been reviewed against yet.
  const unreviewed = pack && news ? news.articles.filter((a) => a.type === "Update" && a.id > pack.meta.reviewedThroughArticleId).sort((a, b) => b.id - a.id)[0] : undefined;
  if (unreviewed)
    messages.push({
      tone: "warn",
      dismissable: false,
      text: `Nexon posted "${unreviewed.title}" on ${formatWhen(unreviewed.publishedUTC).replace(/, \d{1,2}:\d{2}.*$/, "")}. The guide data hasn't been checked against it yet.`,
    });
  if (packInfo.status === "failed")
    messages.push({ tone: "error", dismissable: false, text: "The guide data couldn't be loaded, so recommendations are unavailable. Your characters are safe." });
  else if (packInfo.fellBack)
    messages.push({ tone: "warn", dismissable: false, text: "The newest guide data couldn't be read, so the built-in guide data is being used." });
  if (notice?.kind === "restored")
    messages.push({ tone: "warn", dismissable: true, text: `Your save file was damaged, so it was restored from the backup taken ${formatWhen(notice.savedAt)}. The damaged file was kept.` });
  if (notice?.kind === "corrupt-kept")
    messages.push({ tone: "error", dismissable: true, text: `Your save file was damaged and no backup could be read. It was kept as ${notice.corruptFile}.` });
  if (notice?.kind === "read-only")
    messages.push({ tone: "error", dismissable: false, text: `Your data was saved by a newer version of this app (format ${notice.version}). Please update the app — nothing will be changed until then.` });
  if (notice?.kind === "invalid")
    messages.push({ tone: "error", dismissable: false, text: <>Your save file couldn't be read, so nothing will be changed. Restore a backup from <a className="underline" href="#/settings">Settings</a>.</> });
  if (saveError) messages.push({ tone: "error", dismissable: false, text: `Couldn't save your changes (${saveError}). They'll be retried.` });
  if (!messages.length) return null;
  return (
    <div className="space-y-2 px-8 pt-3">
      {messages.map((m, i) => (
        <div
          key={i}
          role="alert"
          className={`glass flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-sm ${m.tone === "error" ? "text-danger" : m.tone === "info" ? "text-ink" : "text-maple-deep dark:text-maple-hi"}`}
        >
          <span>{m.text}</span>
          {m.dismissable && (
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Dismiss
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Plan §7.2: "Data v2026.10.07-1 · checked 12 s ago" / "Offline · data from …" — click to check now. */
function FreshnessPill() {
  const pack = usePack();
  const { status, lastChecked, problem, checkNow } = useUpdates();
  const now = useNow(15_000);
  const version = pack?.meta.packVersion ?? "—";
  const dot = { idle: "bg-ink-3", checking: "bg-sky animate-pulse", fresh: "bg-leaf", offline: "bg-maple", "app-update-needed": "bg-maple" }[status];
  const text =
    status === "checking"
      ? "Checking…"
      : status === "offline"
        ? `Offline · data ${version}`
        : status === "app-update-needed"
          ? "App update needed for newest data"
          : lastChecked
            ? `Data ${version} · checked ${relativeTime(lastChecked, now)}`
            : `Data ${version}`;
  return (
    <button
      type="button"
      onClick={() => checkNow?.()}
      title={problem ?? "Guide data version — click to check for updates"}
      className="glass hidden items-center gap-2 rounded-full px-3.5 py-2 text-[12px] font-semibold text-ink-2 hover:text-ink xl:inline-flex"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </button>
  );
}

function TopBar() {
  const rules = useRules();
  const store = useProfileStore();
  const profile = useActiveProfile();
  const openNote = useQuickNote((s) => s.setOpen);
  return (
    <header className="flex items-center justify-between gap-4 px-8 pb-2 pt-5">
      {profile ? (
        <div className="flex items-center gap-3">
          <motion.button
            type="button"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            className="glass flex items-center gap-3 rounded-full py-1.5 pl-1.5 pr-5"
            onClick={() => navigate(`/characters/${profile.id}`)}
          >
            <Portrait profile={profile} className="h-10 w-10 rounded-full" />
            <span className="text-left leading-tight">
              <span className="block font-semibold">{profile.name}</span>
              <span className="block text-[13px] text-ink-2">
                Lv {profile.level} · {jobName(rules, profile.jobId)}
              </span>
            </span>
          </motion.button>
          <span className="relative">
            <Stepper label="Level" value={profile.level} min={1} max={rules.levelCap} onChange={(level) => store.getState().updateProfile(profile.id, (p) => ({ ...p, level }))} />
            <LevelUpBurst level={profile.level} />
          </span>
        </div>
      ) : (
        <Button variant="primary" onClick={() => navigate("/characters")}>
          Choose a character
        </Button>
      )}
      <div className="flex items-center gap-2">
        <FreshnessPill />
        <Button onClick={() => openNote(true)} title="Quick note (Ctrl+N)">
          <NotebookPen size={17} strokeWidth={2.2} />
          Quick note
        </Button>
        <IconButton label="Settings" onClick={() => navigate("/settings")}>
          <Settings size={18} strokeWidth={2.2} />
        </IconButton>
      </div>
    </header>
  );
}

function Routes() {
  const route = useRoute();
  const m = /^\/characters\/([0-9a-f-]{36})$/i.exec(route);
  if (m) return <CharacterSheet profileId={m[1]!} />;
  switch (route) {
    case "/characters":
      return <CharactersScreen />;
    case "/settings":
      return <SettingsScreen />;
    case "/train":
      return <TrainScreen />;
    case "/plan":
      return <ProjectionsScreen />;
    case "/loot":
      return <LootScreen />;
    case "/gear":
      return <GearScreen />;
    case "/quests":
      return <QuestsScreen />;
    case "/news":
      return <NewsScreen />;
    case "/maps":
      return <MapsScreen />;
    default:
      return <HomeScreen />;
  }
}

/** Remembers the last screen per character and restores it when switching (plan §9.1). */
function useLastView() {
  const route = useRoute();
  const store = useProfileStore();
  const activeId = useProfiles((s) => s.file.activeProfileId);
  useEffect(() => {
    const p = store.getState().file.profiles.find((x) => x.id === activeId);
    if (p) navigate(p.lastView); // no-op when already there; runs only when the active character changes
  }, [activeId, store]);
  useEffect(() => {
    const s = store.getState();
    const p = s.file.profiles.find((x) => x.id === s.file.activeProfileId);
    if (p && p.lastView !== route && !route.startsWith("/characters/")) {
      // Also bumps updatedAt, which doubles as "last played" on the character cards.
      s.updateProfile(p.id, (x) => ({ ...x, lastView: route }));
    }
  }, [route, store]);
}

function useShortcuts() {
  const openNote = useQuickNote((s) => s.setOpen);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        openNote(true);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= NAV.length) {
        e.preventDefault();
        navigate(NAV[n - 1]!.path);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [openNote]);
}

function NavRail() {
  const route = useRoute();
  return (
    <nav aria-label="Main" className="glass m-3 mr-0 flex w-[92px] shrink-0 flex-col items-stretch gap-1 rounded-[30px] p-2">
      <div className="mb-2 mt-1 flex justify-center" aria-hidden>
        <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[linear-gradient(160deg,var(--maple-hi),var(--maple-deep))] text-white shadow-[0_8px_18px_-8px_rgb(255_90_30/0.8),inset_0_1px_0_rgb(255_255_255/0.45)]">
          <Leaf size={22} strokeWidth={2.4} />
        </span>
      </div>
      {NAV.map(({ path, label, Icon }, i) => {
        const active = route === path || (path === "/characters" && route.startsWith("/characters/"));
        return (
          <motion.a
            key={path}
            href={`#${path}`}
            title={`${label} (Ctrl+${i + 1})`}
            aria-current={active ? "page" : undefined}
            whileTap={{ scale: 0.9 }}
            transition={spring}
            className={`relative flex flex-col items-center gap-0.5 rounded-[20px] px-1 py-2.5 text-[11px] font-semibold transition-colors ${
              active ? "text-maple-deep dark:text-maple-hi" : "text-ink-2 hover:text-ink"
            }`}
          >
            {active && (
              <motion.span
                layoutId="nav-pill"
                transition={spring}
                className="absolute inset-0 rounded-[20px] bg-[var(--thumb)] shadow-[0_6px_16px_-6px_rgb(0_0_0/0.2)] dark:bg-white/12"
              />
            )}
            <Icon size={22} strokeWidth={active ? 2.4 : 2} className="relative" />
            <span className="relative">{label}</span>
          </motion.a>
        );
      })}
    </nav>
  );
}

export function Shell() {
  const hasProfiles = useProfiles((s) => s.file.profiles.length > 0);
  const status = useProfiles((s) => s.status);
  const route = useRoute();
  useLastView();
  useShortcuts();

  if (!hasProfiles && status === "ready") {
    return (
      <main className="flex min-h-full items-center justify-center px-6 py-10">
        <div className="glass-strong w-full max-w-xl rounded-[34px] p-8">
          <LargeTitle sub="Tell me about your character and I'll guide you — where to train, what to loot and which quests to do.">
            Maple Classic Companion
          </LargeTitle>
          <div className="mt-6">
            <Wizard onDone={() => navigate("/home")} />
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-full">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <NoticeBar />
        <main className="flex-1 overflow-y-auto px-8 pb-10 pt-4">
          <motion.div key={route} className="mx-auto w-full max-w-[1320px]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.9, 0.3, 1] }}>
            <Routes />
          </motion.div>
        </main>
      </div>
      <QuickNoteDialog />
    </div>
  );
}
