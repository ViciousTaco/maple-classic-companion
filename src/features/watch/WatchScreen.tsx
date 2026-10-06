import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, Eye, Lock, MonitorX, ScanText, Settings2, Timer, Trash2 } from "lucide-react";
import { HotkeyPicker, levelEta, SessionSummary, TrainingLog, WatcherData } from "./WatchExtras";
import { navigate, useActiveProfile, usePack, usePlatform, useProfileStore, useProfiles, useRouteQuery } from "../../app/context";
import { observedRates } from "../../engine/observed";
import { Button, Card, EmptyState, LargeTitle, Segmented } from "../../ui/kit";
import { ConfirmDialog } from "../../ui/overlays";
import { mapName, rangeText } from "../guide/text";
import { useTrainingPlan } from "../guide/parts";
import { BigSwitch, useElapsed } from "./WatchControls";
import { WatchSetup } from "./WatchSetup";
import { canWatch, useWatch } from "./useWatch";
import { percentGained } from "./session";
import type { Fields } from "./reading";
import { useNow } from "../guide/parts";
import { toast } from "../../ui/overlays";

const TEXT_STYLES: { value: "smooth" | "pixel"; label: string }[] = [
  { value: "smooth", label: "Smooth" },
  { value: "pixel", label: "Pixel-sharp" },
];
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
  const hotkeyValue = useProfiles((s) => s.file.settings.hotkey);
  const query = useRouteQuery();
  const [setupClicked, setSetupOpen] = useState(false);
  // `?setup=1` (from the top-bar pill before the first setup) opens it too, even when already on this screen.
  const setupOpen = setupClicked || query.get("setup") === "1";
  const [forget, setForget] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const hotkey = useHotkeyStatus();
  const w = useWatch((s) => s);
  const elapsed = useElapsed(w.startedAt);
  const plan = useTrainingPlan(profile);

  if (!canWatch(platform)) {
    return (
      <div className="space-y-6">
        <LargeTitle sub="Reads your game screen while you switch it on">Analyse</LargeTitle>
        <EmptyState title="Analyse works in the desktop app on Windows" icon={<MonitorX size={20} />} />
      </div>
    );
  }
  if (!profile) return <EmptyState title="Pick a character to get started" />;

  const on = w.status !== "off";
  const spotId = w.spotId ?? plan?.primary?.spotId ?? null;
  const spots = pack ? [...pack.trainingSpots].sort((a, b) => mapName(pack, a.mapId).localeCompare(mapName(pack, b.mapId))) : [];
  const s = w.session;
  // The session resets at checkpoints and map changes; the run keeps the whole stretch since switching on.
  const tot = s ? { kills: w.run.kills + s.kills, exp: w.run.exp + s.exp, meso: w.run.meso + s.meso, activeMs: w.run.activeMs + s.activeMs } : w.run;
  const mins = tot.activeMs / 60_000;
  const perHour = (v: number) => (mins >= 1 ? Math.round((v / mins) * 60).toLocaleString("en-AU") : "—");
  // EXP still needed for the level: from the guide's EXP table when it knows this level, else from the % and the
  // (agreed) total. Only from good readings.
  const expLeft = (() => {
    const f = w.fields;
    if (!f.expPercent) return null;
    const pct = f.expPercent.value;
    const need = f.level ? pack?.formulas.expToNext?.[f.level.value] : undefined;
    if (need) return Math.max(0, Math.round(need - (need * pct) / 100));
    if (f.expValue && pct > 0) return Math.max(0, Math.round((f.expValue.value / pct) * (100 - pct)));
    return null;
  })();
  const progress = (() => {
    const pct = w.run.pct + (s ? (percentGained(s) ?? 0) : 0);
    const ms = w.run.pctMs + (s && percentGained(s) !== null ? s.activeMs : 0);
    return { pct, perHour: ms >= 60_000 && pct > 0 ? (pct / ms) * 3_600_000 : null };
  })();
  const eta = s ? levelEta({ ...w.run, pct: w.run.pct + (percentGained(s) ?? 0), pctMs: w.run.pctMs + (percentGained(s) === null ? 0 : s.activeMs) }, s.lastExp) : null;
  const measured = Object.entries(profile.observations).sort((a, b) => b[1].lastAt.localeCompare(a[1].lastAt));

  return (
    <div className="space-y-6">
      <LargeTitle sub="Reads your game screen while you switch it on: level, EXP gained and pace, map, stats, skills and quests">Analyse</LargeTitle>

      <Card className={`p-5 transition-colors ${w.status === "on" ? "ring-2 ring-danger/60" : ""}`}>
        <div className="flex flex-wrap items-center gap-5">
          <BigSwitch
            on={on}
            label="Analyse"
            onChange={(v) => {
              if (v && !setup) setSetupOpen(true);
              else if (v) void w.start(setup?.map ? undefined : spotId);
              else w.stop();
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[24px] font-bold tracking-[-0.02em]">
              {w.status === "on" ? (
                <span className="text-danger">● Analysing · {elapsed}</span>
              ) : w.status === "paused" ? (
                <span className="text-maple-deep dark:text-maple-hi">Paused</span>
              ) : (
                "Off"
              )}
            </p>
            <p className="text-sm text-ink-2">
              {w.status === "off"
                ? w.problem ?? (setup ? `Flip the switch, click the Analyse pill at the top, or press ${hotkeyValue} in game.` : "Set it up once, then switch it on whenever you like.")
                : w.status === "paused"
                  ? w.problem
                  : setup?.map
                    ? "Reading only the boxes you drew, and following you from map to map. Switch off any time."
                    : "Reading only the two boxes you drew. Switch off any time."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HotkeyPicker
              value={hotkeyValue}
              registered={hotkey}
              onChange={async (v) => {
                const p = platform as typeof platform & { hotkeySet?: (a: string) => Promise<{ registered: boolean }> };
                const r = await p.hotkeySet?.(v);
                store.getState().updateSettings({ hotkey: v });
                if (r && !r.registered) toast({ message: `${v} is already used by another app — the watcher can't hear it. Pick another.`, tone: "error", durationMs: 8000 });
                else toast({ message: `On/off key is now ${v}` });
              }}
            />
            <Button onClick={() => setSetupOpen(true)} disabled={on}>
              <Settings2 size={15} /> {setup ? "Set up again" : "Set up"}
            </Button>
          </div>
        </div>

        {pack && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-hairline pt-4 text-sm">
            <label className="flex items-center gap-2">
              <span className="font-semibold text-ink-2">Current map</span>
              {setup?.map && w.autoMap ? (
                <span className="rounded-full bg-fill px-3 py-1.5 font-semibold">
                  {on ? (w.mapText ?? (w.mapId ? mapName(pack, w.mapId) : "reading the minimap…")) : "read from the minimap while watching"}
                </span>
              ) : null}
              <select
                className={`rounded-full bg-fill px-3 py-1.5 ${setup?.map && w.autoMap ? "text-xs text-ink-2" : "font-semibold"}`}
                value={setup?.map && w.autoMap ? "__auto" : (spotId ?? "")}
                onChange={(e) => (e.target.value === "__auto" ? w.followMap() : w.setSpot(e.target.value))}
                aria-label="Which training spot to count against"
              >
                {setup?.map && <option value="__auto">Follows the minimap</option>}
                {spots.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {mapName(pack, sp.mapId)}
                  </option>
                ))}
              </select>
              {on && setup?.map && w.autoMap && w.mapText && !w.mapId && <span className="text-xs text-ink-3">not in this guide's data — still counting</span>}
            </label>
            <span className="flex items-center gap-2">
              <span className="font-semibold text-ink-2">Read every</span>
              <Segmented
                label="Read every"
                value={String(setup?.intervalSec ?? 2)}
                options={INTERVALS}
                onChange={(v) => setup && store.getState().updateSettings({ watch: { ...setup, intervalSec: Number(v) } })}
              />
              <span className="ml-3 font-semibold text-ink-2">Game text looks</span>
              <Segmented
                label="Game text looks"
                value={setup?.textStyle ?? "smooth"}
                options={TEXT_STYLES}
                onChange={(v) => setup && store.getState().updateSettings({ watch: { ...setup, textStyle: v } })}
              />
              {on && setup && w.effectiveIntervalMs > setup.intervalSec * 1000 && (
                <span className="text-xs text-ink-3">reads take longer, so every {(w.effectiveIntervalMs / 1000).toFixed(1)} s for now</span>
              )}
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
                <Tile
                  label="EXP gained"
                  value={tot.exp > 0 ? tot.exp.toLocaleString("en-AU") : "—"}
                  sub={tot.exp > 0 ? `${perHour(tot.exp)} / h${tot.kills > 0 ? ` · ≈ ${tot.kills.toLocaleString("en-AU")} kills` : ""}` : "from the EXP number"}
                />
                <Tile label="Level progress" value={progress.pct > 0 ? `+${progress.pct.toFixed(3)}%` : "—"} sub={progress.perHour !== null ? `${progress.perHour.toFixed(2)}% / h` : "from the EXP %"} />
                <Tile label="Next level" value={eta ?? "—"} sub={eta ? "at this pace" : "needs a few minutes of EXP"} />
                <Tile label="Training time" value={`${Math.floor(mins)} min`} sub="idle time not counted" />
              </dl>
              <p className="mt-2 text-xs text-ink-3">
                EXP gained is the EXP number on your bar, compared from read to read — nothing is missed however fast you kill, and a death
                penalty isn't taken off. Kills are estimated from EXP on maps the guide knows.
                {tot.exp === 0 && progress.pct > 0 ? " The EXP number hasn't read cleanly yet, so progress comes from the EXP % for now." : ""}
              </p>
              <FieldsReadout fields={w.fields} expLeft={expLeft} hasMap={!!setup?.map} />
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 font-display text-[19px] font-semibold">Just now</h3>
              {w.feed.length === 0 ? (
                <p className="text-sm text-ink-3">Level-ups, map moves and stats updates show up here.</p>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-[19px] font-semibold">Stats & skills from the game</h3>
            <p className="mt-1 text-sm text-ink-2">
              Open your Character Stats, Skills or Quest window in game. While watching, the app checks for them every 5 seconds and updates this character (STR/DEX/INT/LUK, HP/MP, damage range, accuracy, avoidability, skill levels, quests in progress or completed) once two reads agree — usually within a few seconds of opening the window. Your level, EXP and map are read every tick. Or read it right now:
            </p>
          </div>
          <Button
            variant="primary"
            disabled={scanning || !setup}
            onClick={async () => {
              setScanning(true);
              try {
                setScanMsg(await w.scanNow());
              } finally {
                setScanning(false);
              }
            }}
          >
            <ScanText size={16} /> {scanning ? "Reading…" : "Read my stats & skills now"}
          </Button>
        </div>
        {(scanMsg || w.lastScan) && (
          <p className="mt-3 text-sm text-ink-2">
            {scanMsg ?? (w.lastScan!.applied ? "Updated from the game" : w.lastScan!.stats || w.lastScan!.skills || w.lastScan!.quests ? "Seen in the game" : "No Stats, Skills or Quest window seen")}
            {w.lastScan?.stats ? ` — ${w.lastScan.stats}` : ""}
            {w.lastScan?.skills ? ` — ${w.lastScan.skills} skill${w.lastScan.skills === 1 ? "" : "s"}` : ""}
            {w.lastScan?.quests ? ` — ${w.lastScan.quests} quest${w.lastScan.quests === 1 ? "" : "s"}` : ""}
          </p>
        )}
      </Card>

      {pack && !on && w.lastSummary && <SessionSummary pack={pack} summary={w.lastSummary} />}

      {pack && (
        <Card className="p-5">
          <h3 className="mb-1 font-display text-[19px] font-semibold">Training log</h3>
          <p className="mb-3 text-sm text-ink-3">Every watched stretch at a map, so you can see whether a spot or a build change paid off.</p>
          <TrainingLog pack={pack} log={profile.trainingLog} />
        </Card>
      )}

      <Card className="p-5">
        <h3 className="mb-3 font-display text-[19px] font-semibold">Your Analyse data</h3>
        <WatcherData
          platform={platform}
          profile={profile}
          diagnostics={setup?.diagnostics ?? false}
          onDiagnostics={(v) => setup && store.getState().updateSettings({ watch: { ...setup, diagnostics: v } })}
          onForget={() => {
            if (w.status !== "off") w.stop();
            store.getState().updateProfile(profile.id, (p) => ({ ...p, observations: {}, trainingLog: [], pace: null, paceTimer: null }));
            toast({ message: `Forgot everything the watcher learned for ${profile.name}` });
          }}
        />
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 flex items-center gap-2 font-display text-[19px] font-semibold">
          <Lock size={17} /> What it does — and never does
        </h3>
        <ul className="grid gap-2 text-sm text-ink-2 sm:grid-cols-2">
          <li className="flex gap-2"><Eye size={15} className="mt-0.5 shrink-0 text-leaf" /> Reads the text inside your boxes every few seconds, using Windows' built-in text recognition (offline).</li>
          <li className="flex gap-2"><Ban size={15} className="mt-0.5 shrink-0 text-danger" /> Never saves or sends a picture. Only the numbers it counted are kept, on this PC.</li>
          <li className="flex gap-2"><Ban size={15} className="mt-0.5 shrink-0 text-danger" /> Never touches the game: no clicks, no keys, no memory reading, no hooks or overlays inside it, no changes to game files. It copies what's already on your screen, the same way Discord or Teams screen sharing does.</li>
          <li className="flex gap-2"><Timer size={15} className="mt-0.5 shrink-0 text-sky" /> Off every time the app starts. Switches itself off if the game closes or your EXP doesn't rise for 20 minutes.</li>
          <li className="flex gap-2"><Eye size={15} className="mt-0.5 shrink-0 text-leaf" /> Knows it's you: it checks the character name on your status bar against this profile. Add the optional map box and it follows you from map to map.</li>
        </ul>
      </Card>

      {pack && measured.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-1 font-display text-[19px] font-semibold">Your measured spots</h3>
          <p className="mb-3 text-sm text-ink-3">After 10 minutes at a spot the guide knows, Train shows these instead of estimates (kills worked out from the EXP you gained).</p>
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
                    <td className="py-2 tabular-nums">{r ? rangeText(r.killsPerHour) : o.kills > 0 ? "need more" : "—"}</td>
                    <td className="py-2 tabular-nums">{r ? rangeText(r.expPerHour) : o.minutes >= 1 && o.exp > 0 ? Math.round((o.exp / o.minutes) * 60).toLocaleString("en-AU") : "—"}</td>
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

/** Each reading's last good value and how long ago it was read — so a missed read never shows as "?". */
function FieldsReadout({ fields, expLeft, hasMap }: { fields: Fields; expLeft: number | null; hasMap: boolean }) {
  const now = useNow(1000).getTime();
  const age = (at: number) => {
    const sec = Math.max(0, Math.round((now - at) / 1000));
    return sec < 5 ? "just now" : sec < 60 ? `${sec}s ago` : `${Math.floor(sec / 60)} min ago`;
  };
  const row = (label: string, f: { value: string; at: number } | null, missing: string) => (
    <div className="flex items-baseline justify-between gap-3 rounded-xl bg-fill px-3 py-1.5" key={label}>
      <span className="text-xs font-semibold text-ink-3">{label}</span>
      {f ? (
        <span className={now - f.at > 30_000 ? "text-ink-3" : "text-ink"}>
          <strong>{f.value}</strong> <span className="text-xs text-ink-3">· {age(f.at)}</span>
        </span>
      ) : (
        <span className="text-xs text-ink-3">{missing}</span>
      )}
    </div>
  );
  const fmt = <T,>(f: { value: T; at: number } | null, show: (v: T) => string) => (f ? { value: show(f.value), at: f.at } : null);
  return (
    <div className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
      {row("Level", fmt(fields.level, (v) => `Lv ${v}`), "not read yet — check the Level box")}
      {row("EXP", fmt(fields.expPercent, (v) => `${v}%`), "not read yet — check the EXP box")}
      {row("EXP total", fmt(fields.expValue, (v) => v.toLocaleString("en-AU")), "shown once two reads agree")}
      {expLeft !== null ? row("EXP left", { value: expLeft.toLocaleString("en-AU"), at: fields.expPercent?.at ?? now }, "") : null}
      {hasMap ? row("Map", fields.map, "not read yet — check the Map box") : null}
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

/** Whether the watch hotkey got registered (null = unknown / not supported here). */
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
