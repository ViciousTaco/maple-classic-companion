import { useEffect, useRef, useState } from "react";
import { Check, Copy, FolderOpen, Keyboard, Trash2 } from "lucide-react";
import type { Pack } from "../../data/pack";
import type { Profile, TrainingRun } from "../../data/schema/profile";
import type { Platform } from "../../platform/types";
import { formatDuration } from "../../engine/projection";
import { Button, Chip, Toggle } from "../../ui/kit";
import { ConfirmDialog, toast } from "../../ui/overlays";
import { mapName } from "../guide/text";
import type { RunSummary, RunTotals } from "./controller";

// Watch-screen pieces for I-32/33/34/37/44 and the owner's "erase what the test taught it" request.

/** I-33: press a combination to set the global watch key. ≥ 1 modifier + a letter/digit/F-key, checked by Rust too. */
export function HotkeyPicker({ value, registered, onChange }: { value: string; registered: boolean | null; onChange: (v: string) => Promise<void> }) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") return setRecording(false);
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return; // wait for the key itself
      const key = /^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : /^[0-9]$/.test(e.key) ? e.key : /^F\d{1,2}$/.test(e.key) ? e.key : null;
      const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean) as string[];
      if (!key || mods.length === 0) {
        toast({ message: "Hold Ctrl, Alt or Shift and press a letter, digit or F-key.", tone: "error" });
        return;
      }
      setRecording(false);
      void onChange([...mods, key].join("+")).catch((err: unknown) => toast({ message: String(err instanceof Error ? err.message : err), tone: "error" }));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => setRecording((r) => !r)}
      title={recording ? "Press the combination now (Esc to cancel)" : "Click to change the on/off key"}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
        recording ? "bg-maple text-white" : registered === false ? "bg-maple/15 text-maple-deep dark:text-maple-hi" : "bg-fill text-ink-2 hover:bg-fill-strong"
      }`}
    >
      <Keyboard size={13} />
      {recording ? "Press keys…" : registered === false ? `${value} is used by another app — click to change` : `${value} · change`}
    </button>
  );
}

/** I-37: at the current pace, when the level ends. */
export function levelEta(run: RunTotals, lastExp: number | null): string | null {
  if (run.pctMs < 3 * 60_000 || run.pct <= 0 || lastExp === null) return null;
  const perHour = (run.pct / run.pctMs) * 3_600_000;
  return formatDuration((100 - lastExp) / perHour);
}

export function summaryLine(pack: Pack, s: RunSummary): string {
  const h = s.activeMs / 3_600_000;
  const per = (v: number) => (h > 0 ? Math.round(v / h).toLocaleString("en-AU") : "—");
  const where = s.maps.map((m) => mapName(pack, m)).join(" → ") || "unknown map";
  const top = Object.entries(s.items)
    .filter(([id]) => !id.startsWith("?:"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, n]) => `${pack.index.itemById.get(id)?.name ?? id} ×${n}`)
    .join(", ");
  return `${where} · ${formatDuration(h)} · ${s.kills.toLocaleString("en-AU")} kills (${per(s.kills)}/h) · ${s.exp.toLocaleString("en-AU")} EXP (${per(s.exp)}/h) · ${s.meso.toLocaleString("en-AU")} meso (${per(s.meso)}/h)${s.pctMs > 0 ? ` · +${s.pct.toFixed(2)}% of Lv ${s.level ?? "?"}` : ""}${top ? ` · picked up ${top}` : ""}`;
}

export function SessionSummary({ pack, summary }: { pack: Pack; summary: RunSummary }) {
  const [copied, setCopied] = useState(false);
  const line = summaryLine(pack, summary);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-fill px-3 py-2">
      <span className="min-w-0 flex-1 text-sm">
        <strong className="text-ink">Last session:</strong> <span className="text-ink-2">{line}</span>
      </span>
      <Button
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(line);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast({ message: "Couldn't copy — select the text and press Ctrl+C", tone: "error" });
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

const runKey = (pack: Pack, key: string) => (key.startsWith("map:") ? (pack.index.mapById.get(key.slice(4))?.name ?? key) : mapName(pack, pack.index.spotById.get(key)?.mapId ?? key));

/** I-34: EXP/hour per stretch at one place, oldest → newest. One series, thin line, 8 px markers, no legend box. */
function RunChart({ runs }: { runs: TrainingRun[] }) {
  const pts = runs.map((r) => ({ y: r.minutes > 0 ? (r.exp / r.minutes) * 60 : 0, label: new Date(r.startedAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) }));
  const [hover, setHover] = useState<number | null>(null);
  if (pts.length < 2) return null;
  const W = 520;
  const H = 120;
  const pad = { l: 44, r: 12, t: 10, b: 20 };
  const max = Math.max(...pts.map((p) => p.y)) * 1.1 || 1;
  const x = (i: number) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const fmt = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : Math.round(v).toLocaleString("en-AU"));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full max-w-[520px]" role="img" aria-label="EXP per hour over your runs here">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--hairline)" strokeWidth="1" />
          <text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">
            {fmt(max * f)}
          </text>
        </g>
      ))}
      <polyline fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" points={pts.map((p, i) => `${x(i)},${y(p.y)}`).join(" ")} />
      {pts.map((p, i) => (
        <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <circle cx={x(i)} cy={y(p.y)} r="10" fill="transparent" />
          <circle cx={x(i)} cy={y(p.y)} r="4" fill="var(--chart-1)" stroke="var(--glass)" strokeWidth="2" />
          {hover === i && (
            <text x={x(i)} y={y(p.y) - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)">
              {fmt(p.y)} EXP/h · {p.label}
            </text>
          )}
        </g>
      ))}
      <text x={pad.l} y={H - 4} fontSize="10" fill="var(--ink-3)">
        {pts[0]!.label}
      </text>
      <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">
        {pts.at(-1)!.label}
      </text>
    </svg>
  );
}

export function TrainingLog({ pack, log }: { pack: Pack; log: TrainingRun[] }) {
  const keys = [...new Set(log.map((r) => r.key))];
  const [key, setKey] = useState<string>(keys.at(-1) ?? "");
  const current = keys.includes(key) ? key : (keys.at(-1) ?? "");
  const runs = log.filter((r) => r.key === current);
  const recent = [...log].reverse().slice(0, 12);
  if (log.length === 0) return <p className="text-sm text-ink-3">Nothing yet — every watched stretch at a map lands here.</p>;
  return (
    <div className="space-y-4">
      {keys.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {keys.map((k) => (
            <button key={k} type="button" onClick={() => setKey(k)} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${k === current ? "bg-maple text-white" : "bg-fill hover:bg-fill-strong"}`}>
              {runKey(pack, k)} · {log.filter((r) => r.key === k).length}
            </button>
          ))}
        </div>
      )}
      {runs.length >= 2 ? <RunChart runs={runs} /> : <p className="text-xs text-ink-3">The chart appears after a second run at {runKey(pack, current)}.</p>}
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-3">
          <tr>
            <th className="pb-2 font-semibold">When</th>
            <th className="pb-2 font-semibold">Where</th>
            <th className="pb-2 font-semibold">Time</th>
            <th className="pb-2 font-semibold">Kills / h</th>
            <th className="pb-2 font-semibold">EXP / h</th>
            <th className="pb-2 font-semibold">Meso / h</th>
            <th className="pb-2 font-semibold">Level</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {recent.map((r) => {
            const h = r.minutes / 60;
            const per = (v: number) => (h > 0 ? Math.round(v / h).toLocaleString("en-AU") : "—");
            return (
              <tr key={r.startedAt + r.key}>
                <td className="py-1.5 tabular-nums text-ink-2">{new Date(r.startedAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                <td className="py-1.5 font-medium">{runKey(pack, r.key)}</td>
                <td className="py-1.5 tabular-nums">{formatDuration(h)}</td>
                <td className="py-1.5 tabular-nums">{per(r.kills)}</td>
                <td className="py-1.5 tabular-nums">{per(r.exp)}</td>
                <td className="py-1.5 tabular-nums">{per(r.meso)}</td>
                <td className="py-1.5 tabular-nums">{r.level ?? "—"}{r.levelPercent !== null && r.levelPercent > 0 ? ` (+${r.levelPercent.toFixed(1)}%)` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {log.length > recent.length && <p className="text-xs text-ink-3">Showing the newest {recent.length} of {log.length}.</p>}
    </div>
  );
}

type LogPlatform = Platform & { watchLogClear?: () => Promise<number> };

/** I-44 + "erase history": the diagnostic log switch, and forgetting everything the watcher learned about a character. */
export function WatcherData({ platform, profile, diagnostics, onDiagnostics, onForget }: { platform: Platform; profile: Profile; diagnostics: boolean; onDiagnostics: (v: boolean) => void; onForget: () => void }) {
  const [confirm, setConfirm] = useState<"forget" | "logs" | null>(null);
  const learned = Object.keys(profile.observations).length + profile.trainingLog.length + (profile.pace ? 1 : 0);
  return (
    <div className="space-y-3">
      <Toggle
        label="Record a diagnostic log"
        detail="Writes the text the watcher recognised and what it made of it to field-notes\watch-log\ — never pictures. Switch on for a test session, then ask a Claude session to assess the log."
        checked={diagnostics}
        onChange={onDiagnostics}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => platform.revealFolder("watch-log").catch(() => toast({ message: "Couldn't open the folder", tone: "error" }))}>
          <FolderOpen size={14} /> Open log folder
        </Button>
        <Button size="sm" onClick={() => setConfirm("logs")}>
          <Trash2 size={14} /> Delete diagnostic logs
        </Button>
        <Button size="sm" variant="danger" onClick={() => setConfirm("forget")} disabled={learned === 0}>
          <Trash2 size={14} /> Forget everything the watcher learned for {profile.name}
        </Button>
        {learned === 0 && <Chip>Nothing learned yet</Chip>}
      </div>
      <p className="text-xs text-ink-3">
        Testing on a different game or account? Make a throwaway character in the app for it and delete the character afterwards — or use “Forget everything” here so nothing from the test mixes with Classic World.
      </p>
      <ConfirmDialog
        open={confirm === "forget"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Forget what the watcher learned for ${profile.name}?`}
        body="Measured spots, the training log and the measured pace are removed. Stats, skills and quests already applied to the character stay (edit them on the character sheet if needed)."
        confirmLabel="Forget"
        danger
        onConfirm={() => {
          onForget();
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "logs"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Delete all diagnostic logs?"
        body="Every file in field-notes\watch-log is removed."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          void (platform as LogPlatform).watchLogClear?.().then(
            (n) => toast({ message: n ? `Deleted ${n} log file${n === 1 ? "" : "s"}` : "No log files to delete" }),
            () => toast({ message: "Couldn't delete the logs", tone: "error" }),
          );
          setConfirm(null);
        }}
      />
    </div>
  );
}
