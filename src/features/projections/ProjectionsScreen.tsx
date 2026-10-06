import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Clock, Coins, Gem, Play, Square, Timer, TrendingUp, X } from "lucide-react";
import { useActiveProfile, usePack, useProfileStore, useProfiles, useRules } from "../../app/context";
import type { Profile } from "../../data/schema/profile";
import { dropChance, formatDuration, hoursToLevel, killsForChance, levelTimeline, mesoSeries, paceFromSession } from "../../engine/projection";
import { knownProbability } from "../../engine/rates";
import { ownDropRate } from "../../engine/observed";
import { formatWhen, SYDNEY } from "../../lib/sydney";
import { Button, Card, Chip, EmptyState, Field, LargeTitle, NumberInput, Segmented, Stepper, inputClass, spring } from "../../ui/kit";
import { ProjectionChart } from "../../ui/ProjectionChart";
import { toast } from "../../ui/overlays";
import { useNow, useTrainingPlan } from "../guide/parts";
import { midOf } from "../guide/text";

// I-20 Projections (approved by the owner 2026-10-05). Every number is labelled with where it came from.

const fmtNum = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString("en-AU"));

function Hero({ big, sub, icon }: { big: string; sub: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-maple/14 text-maple-deep dark:text-maple-hi">{icon}</span>
      <div>
        <motion.p key={big} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="font-display text-[30px] font-bold leading-none tracking-[-0.03em]">
          {big}
        </motion.p>
        <p className="mt-1 text-sm text-ink-2">{sub}</p>
      </div>
    </div>
  );
}

function PaceMeter({ profile }: { profile: Profile }) {
  const store = useProfileStore();
  const rules = useRules();
  const now = useNow(1000);
  const [startPct, setStartPct] = useState<number | undefined>(profile.expPercent ?? undefined);
  const [endPct, setEndPct] = useState<number | undefined>(undefined);
  const [endLevel, setEndLevel] = useState(profile.level);
  const [manualGain, setManualGain] = useState<number | undefined>(undefined);
  const [manualMin, setManualMin] = useState<number | undefined>(undefined);
  const update = (f: (p: Profile) => Profile) => store.getState().updateProfile(profile.id, f);
  const timer = profile.paceTimer;

  const savePace = (percentPerHour: number | null, minutes: number, level: number) => {
    if (!percentPerHour) return toast({ message: "That doesn't add up to any EXP gained — check the numbers.", tone: "error" });
    update((p) => ({ ...p, pace: { percentPerHour, level, minutes, measuredAt: new Date().toISOString() }, paceTimer: null }));
    toast({ message: `Pace saved: ${percentPerHour.toFixed(1)}% of a level per hour` });
  };

  if (timer) {
    const minutes = (now.getTime() - Date.parse(timer.startedAt)) / 60_000;
    const mm = Math.floor(minutes);
    const ss = Math.floor((minutes - mm) * 60);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-maple opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-maple" />
          </span>
          <span className="font-display text-[28px] font-bold tabular-nums">
            {mm}:{String(ss).padStart(2, "0")}
          </span>
          <span className="text-sm text-ink-2">started at {timer.startExpPercent}% · Lv {timer.level}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="EXP % now">{(id) => <NumberInput id={id} value={endPct} max={100} onChange={setEndPct} placeholder="e.g. 62" />}</Field>
          <div className="space-y-1.5">
            <p className="pl-1 text-[13px] font-semibold text-ink-2">Level now</p>
            <Stepper label="Level now" value={endLevel} min={timer.level} max={Math.max(rules.levelCap, endLevel)} onChange={setEndLevel} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={endPct === undefined || minutes < 1}
            onClick={() => {
              savePace(paceFromSession(timer.startExpPercent, endPct!, minutes, endLevel - timer.level), minutes, endLevel);
              update((p) => ({ ...p, level: Math.max(p.level, endLevel), expPercent: endPct! }));
            }}
          >
            <Square size={15} /> Stop & save
          </Button>
          <Button variant="ghost" onClick={() => update((p) => ({ ...p, paceTimer: null }))}>
            <X size={15} /> Cancel
          </Button>
        </div>
        {minutes < 1 && <p className="text-xs text-ink-3">Play for at least a minute (10+ is better) for a useful pace.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36">
          <Field label="EXP % right now">{(id) => <NumberInput id={id} value={startPct} max={100} onChange={setStartPct} placeholder="e.g. 40" />}</Field>
        </div>
        <Button
          variant="primary"
          disabled={startPct === undefined}
          onClick={() => update((p) => ({ ...p, paceTimer: { startedAt: new Date().toISOString(), startExpPercent: startPct!, level: p.level } }))}
        >
          <Play size={15} /> Start timer
        </Button>
        <span className="pb-2 text-xs text-ink-3">Then go and train — come back and stop it. The timer keeps running if you close the app.</span>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-ink-2">Or type it in</summary>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Field label="I gained (%)">{(id) => <NumberInput id={id} value={manualGain} max={10000} onChange={setManualGain} />}</Field>
          </div>
          <div className="w-32">
            <Field label="in (minutes)">{(id) => <NumberInput id={id} value={manualMin} max={1440} onChange={setManualMin} />}</Field>
          </div>
          <Button disabled={!manualGain || !manualMin} onClick={() => savePace(paceFromSession(0, manualGain!, manualMin!), manualMin!, profile.level)}>
            Save pace
          </Button>
        </div>
      </details>
    </div>
  );
}

function LevelSection({ profile }: { profile: Profile }) {
  const pack = usePack();
  const rules = useRules();
  const plan = useTrainingPlan(profile);
  const tz = useProfiles((s) => s.file.settings.timeZoneMode) === "sydney" ? SYDNEY : undefined;
  const [perDay, setPerDay] = useState(2);
  const now = useNow(60_000);
  const exp = profile.expPercent ?? 0;
  const table = pack?.formulas.expToNext ?? null;
  const engineExp = midOf(plan?.primary?.estimate.expPerHour ?? null);
  const need = table?.[profile.level];

  let pace: number | null = null;
  let source: React.ReactNode = null;
  if (profile.pace) {
    pace = profile.pace.percentPerHour;
    source = (
      <>
        your measured pace ({pace.toFixed(1)}%/h{profile.pace.level !== profile.level ? `, measured at Lv ${profile.pace.level} — re-measure for accuracy` : ""})
      </>
    );
  } else if (engineExp && need) {
    pace = (engineExp / need) * 100;
    source = <>the engine's estimate for your top spot</>;
  }

  const hours = pace ? hoursToLevel(exp, pace) : null;
  const points = useMemo(() => {
    if (!pace || hours === null) return [];
    if (table && engineExp && !profile.pace) {
      return levelTimeline({ level: profile.level, expPercent: exp, expPerHour: engineExp, expToNext: table, hours: Math.max(hours * 3, 1), cap: rules.levelCap }).map((p) => ({ x: p.x, y: p.y }));
    }
    const n = 30;
    return Array.from({ length: n + 1 }, (_, i) => {
      const x = (Math.max(hours, 0.05) * i) / n;
      return { x, y: Math.min(100, exp + pace! * x) };
    });
  }, [pace, hours, table, engineExp, profile.pace, profile.level, exp, rules.levelCap]);
  const multiLevel = !!(table && engineExp && !profile.pace);
  const eta = hours !== null ? new Date(now.getTime() + (hours / perDay) * 24 * 3_600_000) : null;

  return (
    <Card className="space-y-5">
      {hours === null ? (
        <Hero big="Measure your pace" sub="Classic World's EXP table isn't published yet, so projections use your real pace — it takes one short session." icon={<Timer size={22} />} />
      ) : (
        <Hero
          big={hours === 0 ? "Level up now!" : `Lv ${profile.level + 1} in ${formatDuration(hours)}`}
          sub={<>of play, from {exp}% · based on {source}</>}
          icon={<TrendingUp size={22} />}
        />
      )}
      {hours !== null && points.length > 1 && (
        <>
          <ProjectionChart
            title={multiLevel ? "Level over hours played" : `EXP % towards Lv ${profile.level + 1} over hours played`}
            points={points}
            xLabel={(x) => formatDuration(x)}
            yLabel={(y) => (multiLevel ? `Lv ${y.toFixed(1)}` : `${Math.round(y)}%`)}
            yMin={multiLevel ? Math.floor(points[0]!.y) : 0}
            yMax={multiLevel ? undefined : 100}
            tooltip={(p) => (multiLevel ? `After ${formatDuration(p.x)}: Lv ${Math.floor(p.y)} (${Math.round((p.y % 1) * 100)}%)` : `After ${formatDuration(p.x)}: ${p.y.toFixed(1)}%`)}
          />
          <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-fill px-4 py-3">
            <label className="flex flex-1 items-center gap-3 text-sm font-semibold">
              <Clock size={16} className="text-ink-2" />
              I play
              <input type="range" min={0.5} max={12} step={0.5} value={perDay} onChange={(e) => setPerDay(Number(e.currentTarget.value))} className="flex-1 accent-[var(--maple)]" aria-label="Hours played per day" />
              <span className="w-20 tabular-nums">{perDay} h/day</span>
            </label>
            {eta && (
              <p className="text-sm">
                → <strong>Lv {profile.level + 1}</strong> around <strong>{formatWhen(eta, tz).replace(/,? \d{1,2}:\d{2}.*$/, "")}</strong>
              </p>
            )}
          </div>
        </>
      )}
      <div>
        <h3 className="mb-3 font-display text-[17px] font-semibold">{profile.pace ? "Re-measure your pace" : "Measure your pace"}</h3>
        <PaceMeter profile={profile} />
      </div>
    </Card>
  );
}

function MesoSection({ profile }: { profile: Profile }) {
  const plan = useTrainingPlan(profile);
  const engine = plan?.primary?.estimate.mesoPerHour ?? null;
  const [whatIf, setWhatIf] = useState(20_000);
  const [hours, setHours] = useState(4);
  const usingEngine = engine !== null;
  const low = usingEngine ? engine.low : whatIf;
  const high = usingEngine ? engine.high : whatIf;
  const series = mesoSeries(low, high, hours, 24).map((p) => ({ x: p.x, y: (p.low + p.high) / 2, ...(usingEngine ? { low: p.low, high: p.high } : {}) }));
  return (
    <Card className="space-y-5">
      <Hero
        big={`${fmtNum(low * hours)}${usingEngine ? `–${fmtNum(high * hours)}` : ""} meso`}
        sub={usingEngine ? <>in {hours} h at your top spot (engine estimate, ±20 %)</> : <>in {hours} h if you make {fmtNum(whatIf)} meso an hour — a what-if, not an estimate</>}
        icon={<Coins size={22} />}
      />
      <ProjectionChart
        title="Meso collected over hours played"
        points={series}
        xLabel={(x) => formatDuration(x)}
        yLabel={(y) => fmtNum(y)}
        dashed={!usingEngine}
        tooltip={(p) => `After ${formatDuration(p.x)}: ${p.low !== undefined ? `${fmtNum(p.low)}–${fmtNum(p.high!)}` : fmtNum(p.y)} meso`}
      />
      <div className="grid gap-3 rounded-2xl bg-fill px-4 py-3 sm:grid-cols-2">
        <label className="flex items-center gap-3 text-sm font-semibold">
          Hours
          <input type="range" min={1} max={24} value={hours} onChange={(e) => setHours(Number(e.currentTarget.value))} className="flex-1 accent-[var(--maple)]" aria-label="Hours to project" />
          <span className="w-10 tabular-nums">{hours} h</span>
        </label>
        {!usingEngine && (
          <label className="flex items-center gap-3 text-sm font-semibold">
            What if
            <input type="range" min={1000} max={200_000} step={1000} value={whatIf} onChange={(e) => setWhatIf(Number(e.currentTarget.value))} className="flex-1 accent-[var(--maple)]" aria-label="What-if meso per hour" />
            <span className="w-16 tabular-nums">{fmtNum(whatIf)}/h</span>
          </label>
        )}
      </div>
      {!usingEngine && <p className="text-xs text-ink-3">The guide can estimate this once your damage range is set and the spot's meso data is known.</p>}
    </Card>
  );
}

function DropSection({ profile }: { profile: Profile }) {
  const pack = usePack();
  const plan = useTrainingPlan(profile);
  const candidates = useMemo(() => {
    if (!pack) return [];
    const ids = new Set([...profile.wishlistItemIds, ...pack.drops.filter((d) => d.status !== "legacy-unverified").map((d) => d.itemId)]);
    return [...ids].map((id) => pack.index.itemById.get(id)).filter((i) => i !== undefined).sort((a, b) => a.name.localeCompare(b.name));
  }, [pack, profile.wishlistItemIds]);
  const [itemId, setItemId] = useState<string>(() => profile.wishlistItemIds[0] ?? "");
  const [oneIn, setOneIn] = useState(500);
  const chosen = itemId || candidates[0]?.id || "";
  const known = useMemo(() => {
    if (!pack || !chosen) return null;
    const drops = pack.index.dropsByItem.get(chosen) ?? [];
    const probs = drops.map((d) => ({ d, k: knownProbability(d) })).filter((x) => x.k !== null);
    const best = probs.sort((a, b) => b.k!.p - a.k!.p)[0];
    if (best) return best;
    // I-35: the owner's own pickups per kill (screen watcher) count as a sampled rate.
    const own = drops
      .map((d) => ({ d, r: ownDropRate(pack, profile.observations, d.mobId, chosen) }))
      .filter((x) => x.r !== null && x.r.drops > 0)
      .sort((a, b) => b.r!.drops / b.r!.kills - a.r!.drops / a.r!.kills)[0];
    return own ? { d: own.d, k: { p: own.r!.drops / own.r!.kills, basis: "sampled" as const, sample: own.r! } } : null;
  }, [pack, chosen, profile.observations]);
  const p = known ? known.k!.p : 1 / oneIn;
  const k50 = killsForChance(p, 0.5) ?? 0;
  const k90 = killsForChance(p, 0.9) ?? 0;
  const maxK = Math.max(10, killsForChance(p, 0.97) ?? 100);
  const pts = Array.from({ length: 41 }, (_, i) => {
    const x = Math.round((maxK * i) / 40);
    return { x, y: dropChance(p, x) * 100 };
  });
  const kph = midOf(plan?.primary?.estimate.killsPerHour ?? null);
  const asTime = (k: number) => (kph ? ` (≈ ${formatDuration(k / kph)} at your top spot)` : "");
  const name = pack?.index.itemById.get(chosen)?.name ?? "this item";

  return (
    <Card className="space-y-5">
      <Hero
        big={`${k50.toLocaleString("en-AU")} kills`}
        sub={
          <>
            for a 50 % chance at <strong>{name}</strong>
            {asTime(k50)} · 90 % after {k90.toLocaleString("en-AU")}
          </>
        }
        icon={<Gem size={22} />}
      />
      <div className="flex flex-wrap items-center gap-3">
        <select className={`${inputClass} w-auto`} aria-label="Item" value={chosen} onChange={(e) => setItemId(e.currentTarget.value)}>
          {candidates.length === 0 && <option value="">No items in the guide data yet</option>}
          {candidates.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        {known ? (
          <Chip tone="leaf">{known.k!.basis === "official" ? "Official rate" : `You: ${known.k!.sample!.drops} in ${known.k!.sample!.kills} kills`}</Chip>
        ) : (
          <Chip tone="sky">What-if rate — no real rate is known yet</Chip>
        )}
      </div>
      <ProjectionChart
        title={`Chance to have found ${name} by number of kills`}
        points={pts}
        xLabel={(x) => fmtNum(x)}
        yLabel={(y) => `${Math.round(y)}%`}
        yMin={0}
        yMax={100}
        dashed={!known}
        markers={[
          { x: k50, label: "50%" },
          { x: k90, label: "90%" },
        ]}
        tooltip={(pt) => `After ${pt.x.toLocaleString("en-AU")} kills: ${pt.y.toFixed(1)}%${asTime(pt.x)}`}
      />
      {!known && (
        <label className="flex items-center gap-3 rounded-2xl bg-fill px-4 py-3 text-sm font-semibold">
          What if it drops 1 in
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={Math.log10(oneIn)}
            onChange={(e) => setOneIn(Math.round(10 ** Number(e.currentTarget.value)))}
            className="flex-1 accent-[var(--maple)]"
            aria-label="What-if drop rate, 1 in N"
          />
          <span className="w-20 tabular-nums">{oneIn.toLocaleString("en-AU")}</span>
        </label>
      )}
      <p className="text-xs text-ink-3">
        Nexon hasn't published drop rates for Classic World. The curve uses an official or self-logged rate when one exists; otherwise it's a what-if you control.
      </p>
    </Card>
  );
}

type Tab = "level" | "meso" | "drop";

export function ProjectionsScreen() {
  const profile = useActiveProfile();
  const [tab, setTab] = useState<Tab>("level");
  if (!profile) return <EmptyState title="Pick a character to get started" />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <LargeTitle sub="How long, how much, how likely — drag the sliders and hover the charts">Projections</LargeTitle>
        <Segmented
          size="lg"
          label="Projection"
          value={tab}
          onChange={setTab}
          options={[
            { value: "level", label: <><TrendingUp size={15} />Levelling</>, ariaLabel: "Levelling" },
            { value: "meso", label: <><Coins size={15} />Meso</>, ariaLabel: "Meso" },
            { value: "drop", label: <><Gem size={15} />Drop chance</>, ariaLabel: "Drop chance" },
          ]}
        />
      </div>
      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        {tab === "level" && <LevelSection profile={profile} />}
        {tab === "meso" && <MesoSection profile={profile} />}
        {tab === "drop" && <DropSection profile={profile} />}
      </motion.div>
    </div>
  );
}
