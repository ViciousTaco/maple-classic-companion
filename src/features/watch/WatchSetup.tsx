import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Gamepad2, MonitorUp, RefreshCw, ScanText } from "lucide-react";
import type { Region } from "../../data/schema/profile";
import { useActiveProfile, usePack, usePlatform, useProfileStore, useProfiles } from "../../app/context";
import { Button, Chip } from "../../ui/kit";
import { Dialog } from "../../ui/overlays";
import { parseExpText, parseMapName, parseStatus } from "./parse";
import { CANDIDATES, methodLabel, scoreReading, type Tuning } from "./reading";
import { canWatch } from "./useWatch";
import type { WatchWindow } from "./controller";

// I-29 setup: pick the game window → draw the boxes on a one-off picture → test → save.
// The picture lives only in this dialog's memory and disappears when it closes.

type Snapshot = { pngBase64: string; width: number; height: number; sourceWidth: number; sourceHeight: number; covered?: boolean };
type SnapshotPlatform = { screenSnapshot(windowId: number): Promise<Snapshot> };
// Storage keys kept for saved setups: `status` is the Level box, `expText` the EXP box.
type BoxName = "status" | "expText" | "map";
const BOXES = ["status", "expText", "map"] as const;

const BOX = {
  status: { label: "Level", hint: "Drag a small box around your level and name on the status bar — e.g. “Lv. 272 ViciousTaco”.", color: "var(--sky)", cls: "border-sky bg-sky/15" },
  map: { label: "Map name (optional)", hint: "Drag a box around the map's name at the top of the minimap, so Analyse follows you from map to map.", color: "var(--leaf)", cls: "border-leaf bg-leaf/15" },
  expText: { label: "EXP", hint: "Drag a box around the EXP digits — e.g. “4,012,189,870,315 [72.668%]”. Analyse compares this number from read to read for your EXP gained, EXP per hour and time to level.", color: "#ffcc00", cls: "border-[#ffcc00] bg-[#ffcc00]/15" },
} as const;

const OWN_TITLE = /maple classic companion/i;
const looksLikeGame = (w: WatchWindow) => /maple/i.test(w.title) && !OWN_TITLE.test(w.title);

export function WatchSetup({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Set up Analyse" description="Three quick steps. Nothing is read until you switch Analyse on. Three boxes: Level, EXP, and the minimap's map name (optional — lets Analyse follow you between maps)." wide>
      {open && <Wizard onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function Wizard({ onDone }: { onDone: () => void }) {
  const platform = usePlatform();
  const store = useProfileStore();
  const prev = useProfiles((s) => s.file.settings.watch);
  const pack = usePack();
  const me = useActiveProfile();
  const [windows, setWindows] = useState<WatchWindow[] | null>(null);
  const [win, setWin] = useState<WatchWindow | null>(null);
  const [shot, setShot] = useState<Snapshot | null>(null);
  const [boxes, setBoxes] = useState<Record<BoxName, Region | null>>({ status: null, expText: null, map: null });
  const [drawing, setDrawing] = useState<BoxName>("status");
  const [lastDrawn, setLastDrawn] = useState<BoxName | null>(null);
  const [test, setTest] = useState<{ level: number | null; expPercent: number | null; expValue: number | null; barPercent: number | null; name: string | null; map: string | null; mapLines: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tuning, setTuning] = useState<Tuning>(() => prev?.tuning ?? {});
  const [error, setError] = useState<string | null>(null);

  const fetchWindows = async (): Promise<WatchWindow[]> => {
    if (!canWatch(platform)) return [];
    const all = (await platform.screenListWindows()).filter((w) => !OWN_TITLE.test(w.title));
    return all.sort((a, b) => Number(looksLikeGame(b)) - Number(looksLikeGame(a)) || a.title.localeCompare(b.title));
  };
  const list = () => {
    setError(null);
    fetchWindows().then(setWindows, (e: unknown) => setError(String(e)));
  };
  useEffect(() => {
    let live = true;
    fetchWindows().then(
      (w) => live && setWindows(w),
      (e: unknown) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- list once on open
  }, []);

  const pick = async (w: WatchWindow) => {
    setBusy(true);
    setError(null);
    try {
      const s = await (platform as unknown as SnapshotPlatform).screenSnapshot(w.id);
      setWin(w);
      setShot(s);
      setTest(null);
      const same = prev && prev.sourceWidth === s.sourceWidth && prev.sourceHeight === s.sourceHeight;
      // Older setups had one wide "Level & EXP bar" box: keep it as Level only if it was reasonably small.
      const oldStatus = same && prev.status && prev.status.w < s.sourceWidth * 0.5 ? prev.status : null;
      setBoxes({ status: oldStatus, expText: same ? (prev.expText ?? prev.expBar) : null, map: same ? prev.map : null });
      setDrawing(oldStatus ? "expText" : "status");
    } catch (e) {
      setError(`Couldn't take the picture: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Self-tuning test read: every candidate method for every drawn box in one capture; the best-scoring method per
  // box is kept (and saved), so the reading adapts to this screen's fonts — the live client today, Classic tomorrow.
  const runTest = async () => {
    if (!win || !canWatch(platform)) return;
    setBusy(true);
    setError(null);
    try {
      const drawn = BOXES.filter((b) => boxes[b]);
      const regions = drawn.flatMap((b) =>
        CANDIDATES[b].map((m, i) => ({ name: `${b}#${i}`, ...boxes[b]!, scale: 3, prep: m.prep, filter: m.filter, ...(b === "expText" ? { mode: "both" as const } : {}) })),
      );
      const out = await platform.screenRead(win.id, regions);
      const mapNames = pack ? pack.maps.map((m) => m.name) : [];
      const pickedTuning: Tuning = {};
      const best: Partial<Record<BoxName, { lines: string[]; digits?: string }>> = {};
      for (const b of drawn) {
        let top = -1;
        CANDIDATES[b].forEach((m, i) => {
          const r = out.find((x) => x.name === `${b}#${i}`);
          const lines = r?.lines.map((l) => l.text) ?? [];
          const score = scoreReading(b, lines, r?.digits, me?.name ?? null, mapNames);
          if (score > top) {
            top = score;
            pickedTuning[b] = m;
            best[b] = { lines, digits: r?.digits };
          }
        });
      }
      setTuning(pickedTuning);
      const status = parseStatus(best.status?.lines ?? []);
      if (best.expText) {
        const e = parseExpText(best.expText.lines, best.expText.digits);
        if (e.expPercent !== null) status.expPercent = e.expPercent;
        if (e.expValue !== null) status.expValue = e.expValue;
      }
      const mapLines = best.map?.lines ?? [];
      const map = pack ? parseMapName(mapLines, mapNames) : null;
      setTest({ level: status.level, expPercent: status.expPercent, expValue: status.expValue, barPercent: null, name: status.name, map, mapLines });
    } catch (e) {
      setError(`Test read failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!win || !shot) return;
    store.getState().updateSettings({
      watch: {
        windowTitle: win.title,
        sourceWidth: shot.sourceWidth,
        sourceHeight: shot.sourceHeight,
        status: boxes.status,
        chat: null,
        map: boxes.map,
        expBar: null,
        expText: boxes.expText,
        intervalSec: prev?.intervalSec ?? 2,
        diagnostics: prev?.diagnostics ?? false,
        textStyle: prev?.textStyle ?? "smooth",
        tuning,
        savedAt: new Date().toISOString(),
      },
    });
    onDone();
  };

  if (!canWatch(platform)) return <p className="text-ink-2">Analyse works in the desktop app on Windows.</p>;

  return (
    <div className="space-y-5">
      <Step n={1} title="Pick the game window" done={!!win}>
        {windows === null ? (
          <p className="text-sm text-ink-3">Looking for windows…</p>
        ) : windows.length === 0 ? (
          <p className="text-sm text-ink-2">No windows found. Start MapleStory, then refresh.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {windows.slice(0, 12).map((w) => (
              <button
                key={w.id}
                type="button"
                disabled={busy || w.minimized}
                onClick={() => void pick(w)}
                className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm transition ${
                  win?.id === w.id ? "bg-maple text-white" : looksLikeGame(w) ? "bg-leaf/15 hover:bg-leaf/25" : "bg-fill hover:bg-fill-strong"
                } disabled:opacity-50`}
              >
                {looksLikeGame(w) ? <Gamepad2 size={15} /> : <MonitorUp size={15} />}
                <span className="max-w-64 truncate font-semibold">{w.title}</span>
                <span className="text-xs opacity-75">{w.minimized ? "minimised — restore it first" : `${w.width}×${w.height}`}</span>
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={list}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>
        )}
      </Step>

      {shot && (
        <Step n={2} title="Draw the boxes" done={!!boxes.status && !!boxes.expText}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {BOXES.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => {
                  setDrawing(b);
                  setLastDrawn(b);
                }}
                className={`rounded-full px-3 py-1 text-sm font-semibold transition ${drawing === b ? "bg-maple text-white" : "bg-fill hover:bg-fill-strong"}`}
              >
                <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: BOX[b].color }} />
                {BOX[b].label} {boxes[b] ? "✓" : ""}
              </button>
            ))}
          </div>
          {shot.covered && (
            <p className="mb-2 rounded-2xl bg-maple/12 px-3 py-2 text-sm text-maple-deep dark:text-maple-hi">
              Part of the game was hidden behind another window when the picture was taken. Bring the game to the front and pick it again.
            </p>
          )}
          <p className="mb-2 text-sm text-ink-2">{BOX[drawing].hint}</p>
          <BoxCanvas shot={shot} boxes={boxes} drawing={drawing} onBox={(r) => {
            setBoxes((b) => ({ ...b, [drawing]: r }));
            setLastDrawn(drawing);
            setTest(null);
            const next = BOXES.find((b) => b !== drawing && !boxes[b] && BOXES.indexOf(b) > BOXES.indexOf(drawing)) ?? BOXES.find((b) => b !== drawing && !boxes[b]);
            if (next) setDrawing(next);
          }} />
          <Magnifier shot={shot} box={boxes[lastDrawn ?? drawing]} label={BOX[lastDrawn ?? drawing].label} />
          <p className="mt-2 text-xs text-ink-3">
            This picture is only shown here so you can draw on it. It isn't saved anywhere. It's shown at {Math.round((shot.width / shot.sourceWidth) * 100)}% of the game's size; Analyse reads the real pixels, enlarged 3×.
          </p>
        </Step>
      )}

      {shot && (boxes.status || boxes.map || boxes.expText) && (
        <Step n={3} title="Test it" done={!!test}>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void runTest()} disabled={busy}>
              <ScanText size={15} /> Test read
            </Button>
            {test && (
              <>
                <Chip tone={test.level !== null ? "leaf" : "neutral"}>Level: {test.level ?? "not found"}</Chip>
                <Chip tone={test.expPercent !== null ? "leaf" : "neutral"}>EXP: {test.expPercent !== null ? `${test.expPercent}%${test.expValue !== null ? ` · ${test.expValue.toLocaleString("en-AU")}` : ""}` : "not found"}</Chip>
                {boxes.status && (
                  <Chip tone={test.name && me && test.name.toLowerCase() === me.name.toLowerCase() ? "leaf" : test.name ? "maple" : "neutral"}>
                    Name: {test.name ?? "not found"}
                    {test.name && me && test.name.toLowerCase() !== me.name.toLowerCase() ? ` — this profile is ${me.name}` : ""}
                  </Chip>
                )}
                {boxes.map && <Chip tone={test.map ? "leaf" : "neutral"}>Map: {test.map ?? (test.mapLines.length ? `“${test.mapLines[0]}” isn't a map the guide knows` : "nothing read")}</Chip>}
              </>
            )}
          </div>
          {test && Object.keys(tuning).length > 0 && (
            <p className="mt-2 text-xs text-ink-3">
              Best way to read each box on this screen (saved with the setup):{" "}
              {BOXES.filter((b) => tuning[b]).map((b) => `${BOX[b].label.replace(" (optional)", "")}: ${methodLabel(tuning[b]!)}`).join(" · ")}
            </p>
          )}
          {test && test.expPercent === null && boxes.expText && (
            <p className="mt-2 text-sm text-ink-2">EXP digits not read — make the EXP box a little tighter around the digits (keep the thin bar under them inside it).</p>
          )}
          {test && test.level === null && boxes.status && (
            <p className="mt-2 text-sm text-ink-2">Level not found — try a slightly bigger box around “Lv.” and your name.</p>
          )}
        </Step>
      )}

      {error && <p className="rounded-2xl bg-maple/12 px-3 py-2 text-sm text-maple-deep dark:text-maple-hi">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!win || !shot || !boxes.status || !boxes.expText} onClick={save}>
          <CheckCircle2 size={16} /> Save setup
        </Button>
      </div>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 font-display text-[17px] font-semibold">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-leaf text-white" : "bg-fill-strong"}`}>{done ? "✓" : n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The drawn box at 1:1 (or larger when small), so the owner can see exactly what the watcher will read. */
function Magnifier({ shot, box, label }: { shot: Snapshot; box: Region | null; label: string }) {
  if (!box) return null;
  const k = shot.width / shot.sourceWidth; // picture px per source px
  const zoom = Math.max(1, Math.min(4, Math.floor(600 / Math.max(1, box.w * k))));
  const style = {
    width: box.w * k * zoom,
    height: box.h * k * zoom,
    backgroundImage: `url(data:image/png;base64,${shot.pngBase64})`,
    backgroundSize: `${shot.width * zoom}px ${shot.height * zoom}px`,
    backgroundPosition: `-${box.x * k * zoom}px -${box.y * k * zoom}px`,
    imageRendering: zoom > 1 ? ("pixelated" as const) : ("auto" as const),
  };
  return (
    <div className="mt-2">
      <p className="mb-1 text-xs font-semibold text-ink-2">
        {label}: what Analyse sees ({box.w}×{box.h} px{zoom > 1 ? `, shown ${zoom}×` : ""})
      </p>
      <div className="max-w-full overflow-auto rounded-xl border border-hairline">
        <div style={{ ...style, maxWidth: "none" }} />
      </div>
    </div>
  );
}

function BoxCanvas({ shot, boxes, drawing, onBox }: { shot: Snapshot; boxes: Record<BoxName, Region | null>; drawing: BoxName; onBox: (r: Region) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const toSource = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const k = shot.sourceWidth / r.width;
    return {
      x: Math.round(Math.min(Math.max(0, clientX - r.left), r.width) * k),
      y: Math.round(Math.min(Math.max(0, clientY - r.top), r.height) * (shot.sourceHeight / r.height)),
    };
  };
  const pct = (b: Region) => ({
    left: `${(b.x / shot.sourceWidth) * 100}%`,
    top: `${(b.y / shot.sourceHeight) * 100}%`,
    width: `${(b.w / shot.sourceWidth) * 100}%`,
    height: `${(b.h / shot.sourceHeight) * 100}%`,
  });
  const live = drag && { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) };
  return (
    <div
      ref={ref}
      className="relative cursor-crosshair touch-none select-none overflow-hidden rounded-2xl"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = toSource(e.clientX, e.clientY);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = toSource(e.clientX, e.clientY);
        setDrag({ ...drag, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (live && live.w >= 8 && live.h >= 8) onBox({ x: live.x, y: live.y, w: Math.min(live.w, 4000), h: Math.min(live.h, 4000) });
        setDrag(null);
      }}
    >
      <img src={`data:image/png;base64,${shot.pngBase64}`} alt="The game window (one-off picture for drawing the boxes)" className="block w-full" draggable={false} />
      {BOXES.map((b) =>
        boxes[b] && !(drag && b === drawing) ? (
          <div key={b} className={`pointer-events-none absolute rounded-md border-2 ${BOX[b].cls}`} style={pct(boxes[b])}>
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{BOX[b].label}</span>
          </div>
        ) : null,
      )}
      {live && <div className={`pointer-events-none absolute rounded-md border-2 border-dashed ${BOX[drawing].cls}`} style={pct(live)} />}
    </div>
  );
}
