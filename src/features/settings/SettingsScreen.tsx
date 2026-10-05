import { useEffect, useState } from "react";
import { navigate, usePack, usePackInfo, usePlatform, useProfileStore, useProfiles } from "../../app/context";
import { useUpdates } from "../../app/updates";
import { ExternalLinkButton } from "../guide/parts";
import { relativeTime } from "../characters/hooks";
import pkg from "../../../package.json";
import type { AppPaths, BackupInfo, FolderName } from "../../platform/types";
import type { Settings } from "../../data/schema/profile";
import { migrate } from "../../data/schema/migrations";
import { formatWhen, SYDNEY } from "../../lib/sydney";
import { Button, Card, LargeTitle, Toggle } from "../../ui/kit";
import { ConfirmDialog, toast } from "../../ui/overlays";

/** Whether Windows will show the reminder as a notification, or the app falls back to a banner + taskbar flash. */
function NotifyStatusLine() {
  const platform = usePlatform() as ReturnType<typeof usePlatform> & { notifyStatus?: () => Promise<{ toast: boolean; reason: string | null }> };
  const [status, setStatus] = useState<{ toast: boolean; reason: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    platform.notifyStatus?.().then(
      (s) => live && setStatus(s),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [platform]);
  if (!status) return null;
  return (
    <p className="py-2 text-xs text-ink-3">
      {status.toast
        ? "Shows as a Windows notification."
        : `Windows notifications aren't available here${status.reason ? ` (${status.reason})` : ""}, so reminders show as a banner in the app and the taskbar button flashes.`}
    </p>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="font-medium">{label}</span>
      <select className="rounded-full border border-hairline bg-field px-3 py-1.5 font-medium" value={value} onChange={(e) => onChange(e.currentTarget.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SettingsScreen() {
  const platform = usePlatform();
  const store = useProfileStore();
  const settings = useProfiles((s) => s.file.settings);
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const tz = settings.timeZoneMode === "sydney" ? SYDNEY : undefined;

  useEffect(() => {
    void platform.getPaths().then(setPaths);
    void platform.backupsList().then(setBackups);
  }, [platform]);

  const set = (change: Partial<Settings>) => store.getState().updateSettings(change);
  const open = (which: FolderName) => () =>
    void platform.revealFolder(which).catch((err) => toast({ message: `Couldn't open the folder: ${String(err)}`, tone: "error" }));

  const restore = async (b: BackupInfo) => {
    try {
      await store.getState().flush();
      const m = migrate(JSON.parse(await platform.backupsRestore(b.file)));
      if (m.kind !== "ok") throw new Error(m.kind === "invalid" ? m.error : "That backup was made by a newer version of the app.");
      await platform.backupNow(); // keep what we're replacing
      store.getState().replaceFile(m.file);
      await store.getState().flush();
      setBackups(await platform.backupsList());
      toast({ message: `Restored the backup from ${formatWhen(b.savedAt, tz)}` });
    } catch (err) {
      toast({ message: `Couldn't restore: ${String(err instanceof Error ? err.message : err)}`, tone: "error", durationMs: 8000 });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <LargeTitle>Settings</LargeTitle>

      <Card>
        <h2 className="mb-2 font-display text-[19px] font-semibold">Display</h2>
        <div className="divide-y divide-hairline">
          <Select
            label="Times shown in"
            value={settings.timeZoneMode}
            options={[
              ["sydney", "Sydney time (AEST/AEDT)"],
              ["system", "This PC's time zone"],
            ]}
            onChange={(timeZoneMode) => set({ timeZoneMode })}
          />
          <Select
            label="Animations"
            value={settings.motion}
            options={[
              ["system", "Follow Windows"],
              ["full", "Full"],
              ["reduced", "Reduced"],
            ]}
            onChange={(motion) => set({ motion })}
          />
          <Select
            label="Theme"
            value={settings.theme}
            options={[
              ["system", "Follow Windows"],
              ["day", "Day"],
              ["night", "Night"],
            ]}
            onChange={(theme) => set({ theme })}
          />
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-display text-[19px] font-semibold">Event reminders</h2>
        <div className="divide-y divide-hairline">
          <Toggle
            label="Remind me before events and deadlines"
            detail="A Windows notification shortly before a GM event starts or a deadline passes (deadlines also get a day's warning). Turn single events off with the bell on Home or News."
            checked={settings.reminders.enabled}
            onChange={(enabled) => set({ reminders: { ...settings.reminders, enabled } })}
          />
          {settings.reminders.enabled && <NotifyStatusLine />}
          {settings.reminders.enabled && (
            <Select
              label="How early"
              value={String(settings.reminders.leadMinutes)}
              options={[
                ["5", "5 minutes before"],
                ["15", "15 minutes before"],
                ["30", "30 minutes before"],
                ["60", "1 hour before"],
              ]}
              onChange={(v) => set({ reminders: { ...settings.reminders, leadMinutes: Number(v) } })}
            />
          )}
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-[19px] font-semibold">Screen watcher</h2>
        <p className="mt-1 text-sm text-ink-2">
          {settings.watch
            ? `Set up for “${settings.watch.windowTitle}”. Off every time the app starts — switch it on with the Watch pill at the top or Ctrl+Alt+W.`
            : "Counts your kills, EXP, meso and pickups from the game screen while you switch it on. Not set up yet."}
        </p>
        <div className="mt-3">
          <Button onClick={() => navigate(settings.watch ? "/watch" : "/watch?setup=1")}>{settings.watch ? "Open the watcher" : "Set it up"}</Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-[19px] font-semibold">Your data</h2>
        <p className="mt-1 break-all font-mono text-sm">{paths?.dataDir ?? "…"}</p>
        <p className="mt-1 text-sm text-ink-3">
          {paths?.portable === false
            ? "The folder beside the app couldn't be written to, so your data is stored here instead."
            : "Stored beside the app — copy the app and this folder together to move everything."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={open("data")}>Open data folder</Button>
          <Button size="sm" onClick={open("field-notes")}>Open field notes</Button>
          <Button size="sm" onClick={open("exports")}>Open exports</Button>
          <Button size="sm" onClick={open("backups")}>Open backups</Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-[19px] font-semibold">Restore from backup</h2>
        <p className="mt-1 text-sm text-ink-3">A backup is taken the first time you change something each session, then at most hourly. The newest 20 are kept.</p>
        {backups === null ? (
          <p className="mt-3 text-sm">Loading…</p>
        ) : backups.length === 0 ? (
          <p className="mt-3 text-sm">No backups yet.</p>
        ) : (
          <ul className="mt-3 max-h-64 divide-y divide-hairline overflow-y-auto">
            {backups.map((b) => (
              <li key={b.file} className="flex items-center justify-between py-2 text-sm">
                <span>{formatWhen(b.savedAt, tz)}</span>
                <Button size="sm" variant="ghost" onClick={() => setRestoring(b)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <UpdatesCard />

      <Card>
        <h2 className="font-display text-[19px] font-semibold">Sources & credits</h2>
        <ul className="mt-3 space-y-3 text-sm">
          <li>
            <strong>Nexon</strong> — official news, patch notes, events and launch facts (read live from Nexon's public news feed).{" "}
            <ExternalLinkButton href="https://www.nexon.com/maplestory/news">nexon.com</ExternalLinkButton>
          </li>
          <li>
            <strong>MapleClassic Wiki</strong> — monsters, maps, spawns, drops, items, NPCs, job quests, class stat guides and pictures. Data adapted
            under{" "}
            <ExternalLinkButton href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</ExternalLinkButton> (restructured into
            the guide data; shared under the same licence). Pictures are shown for personal use only and cached on this PC.{" "}
            <ExternalLinkButton href="https://mapleclassic.wiki/">mapleclassic.wiki</ExternalLinkButton>
          </li>
          <li>
            <strong>NiaMeowDB</strong> — linked to, never copied.{" "}
            <ExternalLinkButton href="https://meowdb.com/msclassic/">meowdb.com</ExternalLinkButton>
          </li>
          <li>
            <strong>Your own field notes</strong> — what you record with Quick note becomes "Seen in game" data, the most trusted kind.
          </li>
          <li className="text-ink-3">
            Built with Tauri, React, Motion, Radix UI, Zod and Zustand (MIT), Lucide icons (ISC), Bricolage Grotesque and Figtree fonts (SIL Open Font
            License).
          </li>
        </ul>
        <p className="mt-4 text-sm text-ink-3">
          Not affiliated with or endorsed by Nexon. MapleStory and all related names, images and assets belong to Nexon. This is a free,
          non-commercial fan tool. It never changes or interacts with the game; the optional screen watcher only reads the text in your
          two boxes while you switch it on, and never saves or sends a picture.
        </p>
      </Card>

      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(o) => !o && setRestoring(null)}
        title="Restore this backup?"
        body={
          <>
            All characters will go back to how they were on <strong>{restoring && formatWhen(restoring.savedAt, tz)}</strong>. Your current
            data is backed up first, so you can undo this from the same list.
          </>
        }
        confirmLabel="Restore"
        onConfirm={() => restoring && void restore(restoring)}
      />
    </div>
  );
}

/** Version, guide data and update status (P8). */
function UpdatesCard() {
  const pack = usePack();
  const info = usePackInfo();
  const { status, lastChecked, problem, checkNow, appRelease } = useUpdates();
  return (
    <Card>
      <h2 className="font-display text-[19px] font-semibold">Version & updates</h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-ink-3">App</dt>
        <dd>
          {pkg.version}
          {appRelease && <span className="ml-2 font-semibold text-maple-deep dark:text-maple-hi">· {appRelease.version} available</span>}
        </dd>
        <dt className="text-ink-3">Guide data</dt>
        <dd>
          {pack?.meta.packVersion ?? "—"} {info.status === "ready" && <span className="text-ink-3">({info.from === "installed" ? "downloaded update" : "built into the app"})</span>}
        </dd>
        <dt className="text-ink-3">Checked against</dt>
        <dd>Nexon article #{pack?.meta.reviewedThroughArticleId ?? "—"}</dd>
        <dt className="text-ink-3">Last check</dt>
        <dd>
          {lastChecked ? relativeTime(lastChecked) : "not yet"} · {status === "offline" ? "couldn't reach the update feed" : status === "app-update-needed" ? "an app update is needed for the newest data" : status === "checking" ? "checking…" : "up to date"}
        </dd>
      </dl>
      {problem && <p className="mt-2 text-xs text-ink-3">{problem}</p>}
      <div className="mt-3">
        <Button size="sm" onClick={() => checkNow?.()} disabled={!checkNow || status === "checking"}>
          Check for updates now
        </Button>
      </div>
      <p className="mt-3 text-xs text-ink-3">The app checks for news, guide data and app updates when it opens and every 30 minutes while it's open — no restart needed.</p>
    </Card>
  );
}
