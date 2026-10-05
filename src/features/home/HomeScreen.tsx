import { useMemo } from "react";
import { motion } from "motion/react";
import { CalendarClock, ChevronRight, MapPin, ScrollText, Swords } from "lucide-react";
import { navigate, useActiveProfile, usePack, useProfiles, useRules } from "../../app/context";
import { activeGameLabel, jobName, type GameRules } from "../../data/gameRules";
import type { Profile } from "../../data/schema/profile";
import { availableQuests, rankQuests } from "../../engine/quests";
import { formatWhen, SYDNEY } from "../../lib/sydney";
import { Card, EmptyState, LargeTitle, spring } from "../../ui/kit";
import { endingSoon, stateLabel } from "../events/events";
import { useNow, useTrainingPlan, Scene } from "../guide/parts";
import { mapName, rangeText, reasonText, sceneHue } from "../guide/text";
import { EntityImage } from "../guide/EntityImage";
import { JobAdvanceCard } from "../quests/QuestsScreen";

type Milestone = { level: number; label: string };

/** Lv 1 → 1st job → citizenship → party quest → 2nd job → cap, all read from the pack (P5-T7). */
export function milestones(rules: GameRules): Milestone[] {
  const out: Milestone[] = [{ level: 1, label: "Start" }];
  const firstJob = Math.min(...rules.jobAdvancements.filter((a) => a.from === "beginner").map((a) => a.level));
  if (Number.isFinite(firstJob)) out.push({ level: firstJob, label: "1st job" });
  out.push({ level: rules.citizenship.minLevel, label: "Citizenship" });
  for (const pq of rules.partyQuests) out.push({ level: pq.minLevel, label: "Party quest" });
  const second = Math.min(...rules.jobAdvancements.filter((a) => a.from !== "beginner").map((a) => a.level));
  if (Number.isFinite(second)) out.push({ level: second, label: "2nd job" });
  out.push({ level: rules.levelCap, label: "Max level" });
  return out.sort((a, b) => a.level - b.level);
}

function Journey({ rules, profile }: { rules: GameRules; profile: Profile }) {
  const ms = milestones(rules);
  const next = ms.find((m) => m.level > profile.level);
  const prev = [...ms].reverse().find((m) => m.level <= profile.level) ?? ms[0]!;
  // Within the current level too: EXP % moves the marker between levels.
  const exact = profile.level + (profile.expPercent ?? 0) / 100;
  const toNext = next ? Math.min(100, Math.max(0, ((exact - prev.level) / (next.level - prev.level || 1)) * 100)) : 100;
  const overall = Math.min(100, ((exact - 1) / Math.max(1, rules.levelCap - 1)) * 100);
  // Piecewise scale so early milestones aren't squashed against Lv 1.
  const pos = (lvl: number) => {
    const i = ms.findIndex((m) => m.level >= lvl);
    if (i <= 0) return 0;
    const a = ms[i - 1]!;
    const b = ms[i]!;
    return ((i - 1 + (lvl - a.level) / (b.level - a.level || 1)) / (ms.length - 1)) * 100;
  };
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-ink-3">Your journey</p>
        {next && (
          <p className="text-sm text-ink-2">
            Next: <strong className="text-ink">{next.label}</strong> at Lv {next.level} · {next.level - profile.level} to go ·{" "}
            <strong className="tabular-nums text-maple-deep dark:text-maple-hi">{toNext.toFixed(0)}%</strong> there
          </p>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-3">
        <span className="tabular-nums">{overall.toFixed(1)}%</span> of the way to Lv {rules.levelCap}
        {profile.expPercent !== null && <> · <span className="tabular-nums">{profile.expPercent}%</span> into Lv {profile.level}</>}
      </p>
      <div className="relative mx-3 mb-7 mt-6 h-2 rounded-full bg-fill">
        <motion.div className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--maple-hi),var(--maple))]" initial={{ width: 0 }} animate={{ width: `${pos(exact)}%` }} transition={{ type: "spring", stiffness: 90, damping: 18 }} />
        {ms.map((m) => {
          const reached = profile.level >= m.level;
          return (
            <div key={m.label + m.level} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos(m.level)}%` }}>
              <div className={`h-4 w-4 rounded-full border-[3px] ${reached ? "border-white bg-maple shadow" : "border-white/80 bg-fill-strong"}`} />
              <div className="absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap text-center text-[11px] leading-tight">
                <span className={`block font-semibold ${reached ? "text-ink" : "text-ink-3"}`}>{m.label}</span>
                <span className="text-ink-3">Lv {m.level}</span>
              </div>
            </div>
          );
        })}
        <motion.div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" initial={{ left: 0 }} animate={{ left: `${pos(exact)}%` }} transition={{ type: "spring", stiffness: 90, damping: 18 }}>
          <div className="h-6 w-6 rounded-full border-[3px] border-white bg-[linear-gradient(160deg,var(--maple-hi),var(--maple-deep))] shadow-lg" title={`You: Lv ${profile.level}`} />
        </motion.div>
      </div>
    </Card>
  );
}

function Tile({ title, icon, onMore, children, delay = 0 }: { title: string; icon: React.ReactNode; onMore?: () => void; children: React.ReactNode; delay?: number }) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay }} className="glass flex flex-col rounded-[26px] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-[18px] font-semibold">
          <span className="text-maple">{icon}</span>
          {title}
        </h3>
        {onMore && (
          <button type="button" onClick={onMore} className="flex items-center text-sm font-semibold text-sky hover:underline">
            All <ChevronRight size={15} />
          </button>
        )}
      </div>
      {children}
    </motion.section>
  );
}

export function HomeScreen() {
  const rules = useRules();
  const pack = usePack();
  const profile = useActiveProfile();
  const now = useNow();
  const plan = useTrainingPlan(profile);
  const tz = useProfiles((s) => s.file.settings.timeZoneMode) === "sydney" ? SYDNEY : undefined;
  const quests = useMemo(() => (pack && profile ? rankQuests(availableQuests(profile, pack, now), profile, pack).slice(0, 3) : []), [pack, profile, now]);
  const events = useMemo(() => (pack ? endingSoon(pack.events, now).slice(0, 4) : []), [pack, now]);
  if (!profile) return <EmptyState title="Pick a character to get started" />;
  const primary = plan?.primary;

  return (
    <div className="space-y-5">
      <LargeTitle sub={[`Lv ${profile.level} ${jobName(rules, profile.jobId)}`, activeGameLabel(rules, now)].filter(Boolean).join(" · ")}>Hey, {profile.name}</LargeTitle>
      <JobAdvanceCard rules={rules} pack={pack} profile={profile} />
      <Journey rules={rules} profile={profile} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Tile title="Train here now" icon={<Swords size={18} />} onMore={() => navigate("/train")}>
          {primary && pack ? (
            <button type="button" onClick={() => navigate("/train")} className="group flex flex-1 flex-col gap-3 text-left">
              <EntityImage
                kind="map"
                id={primary.mapId}
                name={mapName(pack, primary.mapId)}
                url={pack.index.mapById.get(primary.mapId)?.image}
                fit="cover"
                editable={false}
                className="h-28 w-full rounded-[18px] transition group-hover:brightness-105"
                fallback={<Scene hue={sceneHue(primary.mapId)} rounded="rounded-[18px]" className="h-28 w-full" />}
              />
              <div>
                <p className="font-display text-[20px] font-bold leading-tight">{mapName(pack, primary.mapId)}</p>
                <p className="text-sm text-ink-2">
                  {primary.estimate.expPerHour ? `${rangeText(primary.estimate.expPerHour)} EXP/h` : primary.reasons[0] ? reasonText(pack, primary.reasons[0]) : ""}
                </p>
              </div>
            </button>
          ) : (
            <p className="text-sm text-ink-2">Training data for your level is still being collected. Use Quick note (Ctrl+N) to add what you see in game.</p>
          )}
        </Tile>
        <Tile title="Next quests" icon={<ScrollText size={18} />} onMore={() => navigate("/quests")} delay={0.05}>
          {quests.length ? (
            <ul className="space-y-2">
              {quests.map((q) => (
                <li key={q.id}>
                  <button type="button" onClick={() => navigate("/quests")} className="w-full rounded-2xl bg-fill px-3 py-2 text-left hover:bg-fill-strong">
                    <p className="font-semibold">{q.name}</p>
                    <p className="text-xs text-ink-3">
                      {q.rewards.exp ? `${q.rewards.exp.toLocaleString("en-AU")} EXP · ` : ""}
                      {pack?.index.npcById.get(q.startNpcId)?.name ?? ""}
                      {pack?.index.npcById.get(q.startNpcId) && (
                        <>
                          {" "}
                          <MapPin size={10} className="inline" /> {mapName(pack, pack.index.npcById.get(q.startNpcId)!.mapId)}
                        </>
                      )}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">No quests for your level in the guide data yet.</p>
          )}
        </Tile>
        <Tile title="Ending soon" icon={<CalendarClock size={18} />} onMore={() => navigate("/news")} delay={0.1}>
          {events.length ? (
            <ul className="space-y-2">
              {events.map((s) => (
                <li key={s.event.id} className="rounded-2xl bg-fill px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold leading-tight">{s.event.title}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${s.status === "now" ? "bg-leaf/15 text-leaf" : "bg-sky/12 text-sky"}`}>{s.status === "now" ? "Live" : "Soon"}</span>
                  </div>
                  <p className="text-xs text-ink-2">
                    {stateLabel(s, now)} · {s.at && formatWhen(s.at, tz)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">No events in the next 30 days.</p>
          )}
        </Tile>
      </div>
    </div>
  );
}
