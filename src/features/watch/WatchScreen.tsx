import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, Eye, Keyboard, Lock, MonitorX, Settings2, Timer, Trash2 } from "lucide-react";
import { navigate, useActiveProfile, usePack, usePlatform, useProfileStore, useProfiles, useRouteQuery } from "../../app/context";
import { observedRates } from "../../engine/observed";
import { Button, Card, Chip, EmptyState, LargeTitle, Segmented } from "../../ui/kit";
import { ConfirmDialog } from "../../ui/overlays";
import { mapName, rangeText } from "../guide/text";
import { useTrainingPlan } from "../guide/parts";
import { BigSwitch, useElapsed } from "./WatchControls";
import { WatchSetup } from "./WatchSetup";
import { canWatch, useWatch } from "./useWatch";

const INTERVALS = [
  { value: "1", label: "1 s" },
  { value: "2", label: "2 s" },
  { value: "5", label: "5 s" },
];

export function WatchScreen() {
  const platform = usePlatform();
  const pack = usePack();
  const profile = useActiveProfile();
  const store = useProfileStore();
  const setup = useProfiles((s) => s.file.settings.watch);
  const query = useRouteQuery();
  const [setupClicked, setSetupOpen] = useState(false);
  // `?setup=1` (from the top-bar pill before the first setup) opens it too, even when already on this screen.
  const setupOpen = setupClicked || query.get("setup") === "1";
  const [forget, setForget] = useState<string | null>(null);
  const hotkey = useHotkeyStatus();
  const w = useWatch((s) => s);
  const elapsed = useElapsed(w.startedAt);
  const plan = useTrainingPlan(profile);

  if (!canWatch(platform)) {
    return (
      <div className="space-y-6">
        <LargeTitle sub="Counts kills, EXP, meso and pickups from the game screen">Screen watcher</LargeTitle>
        <EmptyState title="The screen watcher works in the desktop app on Windows" icon={<MonitorX size={20} />} />
      </div>
    );
  }
  if (!profile) return <EmptyState title="Pick a character to get started" />;

  const on = w.status !== "off";
  const spotId = w.spotId ?? plan?.primary?.spotId ?? null;
  const spots = pack ? [...pack.trainingSpots].sort((a, b) => mapName(pack, a.mapId).localeCompare(mapName(pack, b.mapId))) : [];
  const s = w.session;
  const mins = s ? s.activeMs / 60_000 : 0;
  const perHour = (v: number) => (mins >= 1 ? Math.round((v / mins) * 60).toLocaleString("en-AU") : "—");
  const measured = Object.entries(profile.observations).sort((a, b) => b[1].lastAt.localeCompare(a[1].lastAt));

  return (
    <div className="space-y-6">
      <LargeTitle sub="Counts your kills, EXP, meso and pickups from the game screen — only while you switch it on">Screen watcher</LargeTitle>

      <Card className={`p-5 transition-colors ${w.status === "on" ? "ring-2 ring-danger/60" : ""}`}>
        <div className="flex flex-wrap items-center gap-5">
          <BigSwitch
            on={on}
            label="Screen watcher"
            onChange={(v) => {
              if (v && !setup) setSetupOpen(true);
              else if (v) void w.start(spotId);
              else w.stop();
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[24px] font-bold tracking-[-0.02em]">
              {w.status === "on" ? (
                <span className="text-danger">● Watching · {elapsed}</span>
              ) : w.status === "paused" ? (
                <span className="text-maple-deep dark:text-maple-hi">Paused</span>
              ) : (
                "Off"
              )}
            </p>
            <p className="text-sm text-ink-2">
              {w.status === "off"
                ? w.problem ?? (setup ? "Flip the switch, click the Watch pill at the top, or press Ctrl+Alt+W in game." : "Set it up once, then switch it on whenever you like.")
                : w.status === "paused"
                  ? w.problem
                  : setup?.map
                    ? "Reading only the boxes you drew, and following you from map to map. Switch off any time."
                    : "Reading only the two boxes you drew. Switch off any time."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={hotkey === false ? "maple" : "neutral"}>
              <Keyboard size={13} /> {hotkey === false ? "Ctrl+Alt+W is used by another app" : "Ctrl+Alt+W"}
            </Chip>
            <Button onClick={() => setSetupOpen(true)} disabled={on}>
              <Settings2 size={15} /> {setup ? "Set up again" : "Set up"}
            </Button>
          </div>
        </div>

        {pack && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-hairline pt-4 text-sm">
            <label className="flex items-center gap-2">
              <span className="font-semibold text-ink-2">Training at</span>
              <select
                className="rounded-full bg-fill px-3 py-1.5 font-semibold"
                value={setup?.map && w.autoMap ? "__auto" : (spotId ?? "")}
                onChange={(e) => (e.target.value === "__auto" ? w.followMap() : w.setSpot(e.target.value))}
              >
                {setup?.map && <option value="__auto">Wherever you are (follows the minimap)</option>}
                {spots.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {mapName(pack, sp.mapId)}
                  </option>
                ))}
              </select>
              {on && setup?.map && w.autoMap && (
                <span className="text-ink-2">{w.mapId ? `now on ${mapName(pack, w.mapId)}` : "reading the minimap…"}</span>
              )}
            </label>
            <span className="flex items-center gap-2">
              <span className="font-semibold text-ink-2">Read every</span>
              <Segmented
                label="Read every"
                value={String(setup?.intervalSec ?? 2)}
                options={INTERVALS}
                onChange={(v) => setup && store.getState().updateSettings({ watch: { ...setup, intervalSec: Number(v) } })}
              />
            </span>
          </div>
        )}
      </Card>

      <AnimatePresence initial={false}>
        {on && s && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card className="p-5">
              <h3 className="mb-3 font-display text-[19px] font-semibold">This session</h3>
              <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Tile label="Kills" value={s.kills.toLocaleString("en-AU")} sub={`${perHour(s.kills)} / h`} />
                <Tile label="EXP" value={s.exp.toLocaleString("en-AU")} sub={`${perHour(s.exp)} / h`} />
                <Tile label="Meso" value={s.meso.toLocaleString("en-AU")} sub={`${perHour(s.meso)} / h`} />
                <Tile label="Training time" value={`${Math.floor(mins)} min`} sub="idle time not counted" />
              </dl>
              <p className="mt-2 text-xs text-ink-3">
                Only your own “You have gained …” lines count — other players' chat is ignored. In a party, EXP you're given for a party member's kill counts as a kill too.
              </p>
              <p className="mt-3 text-sm text-ink-2">
                {w.read ? (
                  <>
                    Game shows <strong className="text-ink">{w.read.name ?? profile.name}</strong> · <strong className="text-ink">Lv {w.read.level ?? "?"}</strong> · <strong className="text-ink">{w.read.expPercent ?? "?"}%</strong> EXP
                  </>
                ) : (
                  "Waiting for the level bar…"
                )}
              </p>
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 font-display text-[19px] font-semibold">Just now</h3>
              {w.feed.length === 0 ? (
                <p className="text-sm text-ink-3">Kill something — gains show up here.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  <AnimatePresence initial={false}>
                    {w.feed.map((f) => (
                      <motion.li key={f.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="rounded-xl bg-fill px-3 py-1.5">
                        {f.text}
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="p-5">
        <h3 className="mb-3 flex items-center gap-2 font-display text-[19px] font-semibold">
          <Lock size={17} /> What it does — and never does
        </h3>
        <ul className="grid gap-2 text-sm text-ink-2 sm:grid-cols-2">
          <li className="flex gap-2"><Eye size={15} className="mt-0.5 shrink-0 text-leaf" /> Reads the text inside your two boxes every few seconds, using Windows' built-in text recognition (offline).</li>
          <li className="flex gap-2"><Ban size={15} className="mt-0.5 shrink-0 text-danger" /> Never saves or sends a picture. Only the numbers it counted are kept, on this PC.</li>
          <li className="flex gap-2"><Ban size={15} className="mt-0.5 shrink-0 text-danger" /> Never touches the game: no clicks, no keys, no memory reading, no changes to game files.</li>
          <li className="flex gap-2"><Timer size={15} className="mt-0.5 shrink-0 text-sky" /> Off every time the app starts. Switches itself off if the game closes or you stop killing for 20 minutes.</li>
          <li className="flex gap-2"><Eye size={15} className="mt-0.5 shrink-0 text-leaf" /> Knows it's you: it checks the character name on your status bar against this profile, and only your own “You have gained …” lines count. Add the optional map box and it follows you from map to map.</li>
        </ul>
      </Card>

      {pack && measured.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-1 font-display text-[19px] font-semibold">Your measured spots</h3>
          <p className="mb-3 text-sm text-ink-3">After 10 minutes and 30 kills at a spot, Train shows these instead of estimates.</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-3">
              <tr>
                <th className="pb-2 font-semibold">Spot</th>
                <th className="pb-2 font-semibold">Watched</th>
                <th className="pb-2 font-semibold">Kills / h</th>
                <th className="pb-2 font-semibold">EXP / h</th>
                <th className="pb-2 font-semibold">Meso / h</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {measured.map(([id, o]) => {
                const r = observedRates(pack, o);
                const sp = pack.index.spotById.get(id);
                const mapOnly = id.startsWith("map:") ? pack.index.mapById.get(id.slice(4)) : undefined;
                return (
                  <tr key={id}>
                    <td className="py-2 font-medium">
                      <button type="button" className="hover:underline" onClick={() => navigate("/train")}>
                        {sp ? mapName(pack, sp.mapId) : mapOnly ? `${mapOnly.name} (no spot in the guide)` : id}
                      </button>
                    </td>
                    <td className="py-2 tabular-nums">
                      {Math.round(o.minutes)} min · {o.kills.toLocaleString("en-AU")} kills
                    </td>
                    <td className="py-2 tabular-nums">{r ? rangeText(r.killsPerHour) : "need more"}</td>
                    <td className="py-2 tabular-nums">{r ? rangeText(r.expPerHour) : "—"}</td>
                    <td className="py-2 tabular-nums">{r ? rangeText(r.mesoPerHour) : "—"}</td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setForget(id)} aria-label="Forget this spot's numbers">
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <WatchSetup
        open={setupOpen}
        onOpenChange={(v) => {
          setSetupOpen(v);
          if (!v && query.get("setup")) navigate("/watch");
        }}
      />
      <ConfirmDialog
        open={forget !== null}
        onOpenChange={(v) => !v && setForget(null)}
        title="Forget these numbers?"
        body="The watcher's totals for this spot are removed from this character. Train goes back to estimates for it."
        confirmLabel="Forget"
        danger
        onConfirm={() => {
          if (forget) store.getState().updateProfile(profile.id, (p) => ({ ...p, observations: Object.fromEntries(Object.entries(p.observations).filter(([k]) => k !== forget)) }));
          setForget(null);
        }}
      />
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-fill px-3 py-2.5">
      <dt className="text-xs font-semibold text-ink-3">{label}</dt>
      <dd className="font-display text-[21px] font-bold tabular-nums tracking-[-0.02em]">{value}</dd>
      <dd className="text-xs text-ink-2">{sub}</dd>
    </div>
  );
}

/** Whether Ctrl+Alt+W got registered (null = unknown / not supported here). */
function useHotkeyStatus(): boolean | null {
  const platform = usePlatform() as { hotkeyStatus?: () => Promise<{ registered: boolean }> };
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    platform.hotkeyStatus?.().then(
      (r) => live && setOk(r.registered),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [platform]);
  return ok;
}
