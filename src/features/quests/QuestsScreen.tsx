import { useMemo, useState } from "react";
import { toggleQuestStep } from "./steps";
import { motion } from "motion/react";
import { Check, Crown, MapPin, ScrollText, Sparkles } from "lucide-react";
import type { Pack } from "../../data/pack";
import type { Quest } from "../../data/schema/pack";
import type { Profile } from "../../data/schema/profile";
import { navigate, useActiveProfile, usePack, useProfileStore, useRules } from "../../app/context";
import { jobById, jobName, nextAdvancement, type GameRules } from "../../data/gameRules";
import { availableQuests, comingSoon, rankQuests } from "../../engine/quests";
import { Button, Card, Chip, EmptyState, LargeTitle, Section, Sections, Segmented, spring } from "../../ui/kit";
import { YouTubeLite } from "../../ui/YouTubeLite";
import { ConfidenceChip, ExternalLinkButton, useNow } from "../guide/parts";
import { RouteView } from "../guide/RouteView";
import { itemName, mapName, meowdbUrl, mobName } from "../guide/text";

/** P6-T4: pinned job-advancement guide at Lv 8–10 and 28–30 (and whenever the advancement is ready). */
export function JobAdvanceCard({ rules, pack, profile }: { rules: GameRules; pack: Pack | null; profile: Profile }) {
  const next = nextAdvancement(rules, profile.jobId);
  if (!next || profile.level < next.level - 2) return null;
  const ready = profile.level >= next.level;
  const targets = next.to.map((j) => jobById(rules, j)).filter((j) => j !== undefined);
  const quests = pack?.quests.filter((q) => q.category === "job" && q.jobs?.includes(profile.jobId)) ?? [];
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={spring}>
      <Card className={ready ? "ring-2 ring-maple/50" : ""}>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(160deg,var(--maple-hi),var(--maple-deep))] text-white">
            <Crown size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-maple-deep dark:text-maple-hi">{ready ? "Job advancement ready" : `Job advancement at Lv ${next.level}`}</p>
            <p className="font-display text-[20px] font-semibold">
              {jobName(rules, profile.jobId)} → {targets.map((t) => t.name).join(" or ")}
            </p>
            <p className="mt-1 text-sm text-ink-2">
              {(() => {
                // Several classes to choose from (Beginner): list every instructor.
                if (targets.length > 1 && targets.every((t) => t.instructor))
                  return targets.map((t) => `${t.name}: ${t.instructor} in ${t.town}`).join(" · ");
                // Otherwise prefer the guide's quest chain: its first quest's start NPC and map.
                const first = quests.find((q) => q.prereqQuestIds.length === 0 && q.jobs?.includes(profile.jobId));
                const npc = first && pack?.index.npcById.get(first.startNpcId);
                if (first && npc && pack) return `Start "${first.name}" with ${npc.name} in ${pack.index.mapById.get(npc.mapId)?.name ?? "town"}${npc.role ? ` (${npc.role})` : ""}.`;
                if (targets[0]?.instructor) return `Talk to ${targets[0].instructor} in ${targets[0].town}.`;
                return "Where to start isn't confirmed for Classic World yet — it will appear here once it is.";
              })()}
            </p>
            {quests.length > 0 && <p className="mt-1 text-sm text-ink-2">Quest: {quests.map((q) => q.name).join(", ")}</p>}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function QuestBody({ pack, profile, quest }: { pack: Pack; profile: Profile; quest: Quest }) {
  const store = useProfileStore();
  const ticked = new Set(profile.questSteps[quest.id] ?? []);
  const done = profile.unlocks.questsDone.includes(quest.id);
  const startMap = pack.index.npcById.get(quest.startNpcId)?.mapId;
  const meow = meowdbUrl("quest", quest.ext?.meowdb);

  const toggle = (i: number) => store.getState().updateProfile(profile.id, (p) => toggleQuestStep(p, quest, i));
  const setDone = (v: boolean) =>
    store.getState().updateProfile(profile.id, (p) => ({
      ...p,
      unlocks: {
        ...p.unlocks,
        questsDone: v ? [...new Set([...p.unlocks.questsDone, quest.id])] : p.unlocks.questsDone.filter((q) => q !== quest.id),
        questsActive: p.unlocks.questsActive.filter((q) => q !== quest.id),
      },
    }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceChip confidence={quest.confidence} sources={quest.sources} verifiedAt={quest.verifiedAt} />
        <Chip>Lv {quest.minLevel}{quest.maxLevel ? `–${quest.maxLevel}` : "+"}</Chip>
        {quest.repeatable && <Chip tone="sky">Repeatable</Chip>}
        {quest.missable && <Chip tone="maple">Missable</Chip>}
        {meow && <ExternalLinkButton href={meow}>MeowDB</ExternalLinkButton>}
      </div>
      <p className="text-sm text-ink-2">
        Start: <strong className="text-ink">{pack.index.npcById.get(quest.startNpcId)?.name ?? quest.startNpcId}</strong>
        {startMap && <> in {mapName(pack, startMap)}</>}
      </p>
      {quest.steps.length > 0 && (
        <ol className="space-y-1.5">
          {quest.steps.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                role="checkbox"
                aria-checked={ticked.has(i)}
                onClick={() => toggle(i)}
                className="flex w-full items-start gap-3 rounded-2xl bg-fill px-3 py-2 text-left transition hover:bg-fill-strong"
              >
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${ticked.has(i) ? "border-leaf bg-leaf text-white" : "border-ink-3"}`}>
                  {ticked.has(i) && <Check size={12} strokeWidth={3} />}
                </span>
                <span className={ticked.has(i) ? "text-ink-3 line-through" : ""}>
                  {s.text}
                  {s.mobId && <span className="text-ink-3"> · {mobName(pack, s.mobId)}</span>}
                  {s.itemId && <span className="text-ink-3"> · {itemName(pack, s.itemId)}{s.qty ? ` ×${s.qty}` : ""}</span>}
                  {s.mapId && (
                    <span className="text-ink-3">
                      {" "}
                      · <MapPin size={11} className="inline" /> {mapName(pack, s.mapId)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {(quest.rewards.exp || quest.rewards.meso || quest.rewards.items?.length || quest.rewards.fame) && (
        <p className="text-sm">
          <strong>Rewards:</strong>{" "}
          {[
            quest.rewards.exp && `${quest.rewards.exp.toLocaleString("en-AU")} EXP`,
            quest.rewards.meso && `${quest.rewards.meso.toLocaleString("en-AU")} meso`,
            quest.rewards.fame && `${quest.rewards.fame} fame`,
            ...(quest.rewards.items ?? []).map((it) => `${itemName(pack, it.itemId)} ×${it.qty}${it.choice ? " (choose)" : ""}`),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {startMap && (
        <details className="rounded-2xl bg-fill px-3 py-2 text-sm">
          <summary className="cursor-pointer font-semibold">How to get to the start</summary>
          <div className="mt-3">
            <RouteView pack={pack} profile={profile} to={startMap} />
          </div>
        </details>
      )}
      {quest.videoIds?.map((v) => {
        const vid = pack.index.videoById.get(v);
        return vid && vid.status === "ok" ? <YouTubeLite key={v} id={v} title={vid.title} /> : null;
      })}
      <Button size="sm" variant={done ? "secondary" : "tinted"} onClick={() => setDone(!done)}>
        <Check size={14} /> {done ? "Mark as not done" : "Mark as done"}
      </Button>
    </div>
  );
}

type Tab = "available" | "soon" | "done";

export function QuestsScreen({ initialQuery = "" }: { initialQuery?: string }) {
  const pack = usePack();
  const rules = useRules();
  const profile = useActiveProfile();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("available");
  const lists = useMemo(() => {
    if (!pack || !profile) return null;
    const avail = rankQuests(availableQuests(profile, pack, now), profile, pack);
    return {
      available: avail,
      soon: rankQuests(comingSoon(profile, pack, now), profile, pack),
      done: pack.quests.filter((q) => profile.unlocks.questsDone.includes(q.id)),
    };
  }, [pack, profile, now]);
  if (!profile) return <EmptyState title="Pick a character to get started" />;
  if (!pack || !lists) return <EmptyState title="The guide data isn't loaded" />;
  // Opened from search: show the matching quests from every list.
  const needle = initialQuery.trim().toLowerCase();
  const found = needle ? pack.quests.filter((x) => x.name.toLowerCase().includes(needle)) : null;
  const list = found ?? lists[tab];
  const top = tab === "available" ? list.slice(0, 5) : list;
  const rest = tab === "available" ? list.slice(5) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <LargeTitle sub={`For Lv ${profile.level} ${jobName(rules, profile.jobId)}`}>Quests</LargeTitle>
        <Segmented
          size="lg"
          label="Quest list"
          value={tab}
          onChange={setTab}
          options={[
            { value: "available", label: `Available (${lists.available.length})`, ariaLabel: "Available now" },
            { value: "soon", label: `Coming soon (${lists.soon.length})`, ariaLabel: "Coming soon" },
            { value: "done", label: `Done (${lists.done.length})`, ariaLabel: "Done" },
          ]}
        />
      </div>
      {found && (
        <p className="flex items-center gap-2 text-sm text-ink-2">
          Showing quests matching "{initialQuery}" ·
          <button type="button" className="font-semibold text-sky hover:underline" onClick={() => navigate("/quests")}>
            show all
          </button>
        </p>
      )}
      <JobAdvanceCard rules={rules} pack={pack} profile={profile} />
      {list.length === 0 ? (
        <EmptyState title={tab === "done" ? "Nothing finished yet" : "No quests in the guide data for this yet"} icon={tab === "done" ? <Check size={20} /> : <ScrollText size={20} />}>
          {tab !== "done" && "Quests are added as they're confirmed for Classic World."}
        </EmptyState>
      ) : (
        <>
          {tab === "available" && (
            <h3 className="flex items-center gap-2 px-1 font-display text-[19px] font-semibold">
              <Sparkles size={17} className="text-maple" /> Worth doing
            </h3>
          )}
          <Sections>
            {top.map((q) => (
              <Section key={q.id} value={q.id} title={q.name} summary={`${q.category === "job" ? "Job · " : ""}${q.rewards.exp ? `${q.rewards.exp.toLocaleString("en-AU")} EXP` : `Lv ${q.minLevel}+`}`}>
                <QuestBody pack={pack} profile={profile} quest={q} />
              </Section>
            ))}
          </Sections>
          {rest.length > 0 && (
            <>
              <h3 className="px-1 pt-2 font-display text-[17px] font-semibold text-ink-2">More quests</h3>
              <Sections>
                {rest.map((q) => (
                  <Section key={q.id} value={q.id} title={q.name} summary={`Lv ${q.minLevel}+`}>
                    <QuestBody pack={pack} profile={profile} quest={q} />
                  </Section>
                ))}
              </Sections>
            </>
          )}
        </>
      )}
    </div>
  );
}
