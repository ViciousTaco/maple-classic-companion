import { useState } from "react";
import { motion } from "motion/react";
import { Check, Eye, Footprints, RefreshCw, ScrollText } from "lucide-react";
import { useActiveProfile, usePack, usePlatform, useRules } from "../../app/context";
import { jobName } from "../../data/gameRules";
import { findRoute, nearestTown } from "../../engine/route";
import { Button, Chip, spring } from "../../ui/kit";
import { toast } from "../../ui/overlays";
import { EntityImage } from "../guide/EntityImage";
import { Scene, useTrainingPlan } from "../guide/parts";
import { stepText } from "../guide/RouteView";
import { mapName, sceneHue } from "../guide/text";
import type { MiniAction } from "./actions";

// I-24: a small always-on-top card for one-monitor play. Read-only here; changes go to the main window.

type Relay = { relayToMain?: (kind: string, payload: unknown) => Promise<unknown> };

export function useRelay() {
  const platform = usePlatform() as Relay;
  return (a: MiniAction) => {
    if (!platform.relayToMain) return;
    platform.relayToMain(a.kind, a.payload).catch((e: unknown) => toast({ message: `The main window didn't get that: ${String(e)}`, tone: "error" }));
  };
}

export function MiniApp() {
  const pack = usePack();
  const rules = useRules();
  const profile = useActiveProfile();
  const plan = useTrainingPlan(profile);
  const relay = useRelay();
  const [pinned, setPinned] = useState<string | null>(null);

  const all = plan?.primary ? [plan.primary, ...plan.backups] : [];
  const hero = (pinned && all.find((r) => r.spotId === pinned)) || plan?.primary || null;
  const town = pack && hero ? nearestTown(pack, hero.mapId) : null;
  const route = pack && hero && town ? { town: town.mapId, steps: findRoute(pack, town.mapId, hero.mapId, profile?.unlocks.areas ?? []) ?? [] } : null;

  if (!profile) return <p className="p-4 text-sm text-ink-2">Pick a character in the main window.</p>;
  const quests = pack ? profile.unlocks.questsActive.map((id) => pack.index.questById.get(id)).filter((q) => q !== undefined).slice(0, 4) : [];

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 text-[14px]">
      <header className="glass flex items-center justify-between rounded-full px-4 py-2">
        <span className="font-semibold">
          {profile.name} · Lv {profile.level} {jobName(rules, profile.jobId)}
        </span>
        <span className="flex items-center gap-2">
          {profile.expPercent !== null && <span className="tabular-nums text-ink-2">{profile.expPercent}%</span>}
          <button type="button" title="Screen watcher on/off" aria-label="Screen watcher on/off" onClick={() => relay({ kind: "watch-toggle", payload: {} })} className="flex h-7 w-7 items-center justify-center rounded-full bg-fill hover:bg-fill-strong">
            <Eye size={14} />
          </button>
        </span>
      </header>

      {!pack || !hero ? (
        <p className="glass rounded-[22px] p-4 text-ink-2">No training spot for this level yet.</p>
      ) : (
        <>
          <motion.section key={hero.spotId} initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} className="glass overflow-hidden rounded-[22px]">
            <EntityImage
              kind="map"
              id={hero.mapId}
              name={mapName(pack, hero.mapId)}
              url={pack.index.mapById.get(hero.mapId)?.image}
              fit="cover"
              editable={false}
              className="h-24 w-full"
              fallback={<Scene hue={sceneHue(hero.mapId)} rounded="rounded-none" className="h-24 w-full" />}
            />
            <div className="space-y-2 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-maple-deep dark:text-maple-hi">{pinned ? "You picked" : "Train here"}</p>
              <h1 className="font-display text-[19px] font-bold leading-tight">{mapName(pack, hero.mapId)}</h1>
              <div className="flex flex-wrap gap-1">
                {pack.index.spotById.get(hero.spotId)?.mobIds.map((m) => <Chip key={m}>{pack.index.monsterById.get(m)?.name ?? m}</Chip>)}
              </div>
              <Button
                variant="primary"
                className="w-full"
                onClick={() => {
                  setPinned(null);
                  relay({ kind: "skip-spot", payload: { profileId: profile.id, spotId: hero.spotId } });
                }}
              >
                <RefreshCw size={15} /> Map taken? Next backup
              </Button>
            </div>
          </motion.section>

          {all.length > 1 && (
            <section className="flex flex-wrap gap-1.5">
              {all
                .filter((r) => r !== hero)
                .map((r) => (
                  <motion.button key={r.spotId} type="button" whileTap={{ scale: 0.96 }} transition={spring} onClick={() => setPinned(r === plan?.primary ? null : r.spotId)} className="glass rounded-full px-3 py-1.5 text-[13px] font-semibold">
                    {mapName(pack, r.mapId)}
                  </motion.button>
                ))}
            </section>
          )}

          {route && route.steps.length > 0 && (
            <section className="glass rounded-[22px] p-3">
              <h2 className="mb-1.5 flex items-center gap-1.5 font-semibold">
                <Footprints size={15} /> From {mapName(pack, route.town)}
              </h2>
              <ol className="space-y-1 text-[13px] text-ink-2">
                {route.steps.slice(0, 5).map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-bold text-ink-3">{i + 1}</span>
                    {stepText(pack, s)}
                  </li>
                ))}
                {route.steps.length > 5 && <li className="text-ink-3">…and {route.steps.length - 5} more in the main window</li>}
              </ol>
            </section>
          )}
        </>
      )}

      {pack && quests.length > 0 && (
        <section className="glass rounded-[22px] p-3">
          <h2 className="mb-1.5 flex items-center gap-1.5 font-semibold">
            <ScrollText size={15} /> Quests in progress
          </h2>
          <ul className="space-y-2">
            {quests.map((q) => {
              const ticked = new Set(profile.questSteps[q.id] ?? []);
              return (
                <li key={q.id}>
                  <p className="text-[13px] font-semibold">{q.name}</p>
                  <ul className="mt-1 space-y-1">
                    {q.steps.map((st, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => relay({ kind: "quest-step", payload: { profileId: profile.id, questId: q.id, step: i } })}
                          className="flex w-full items-start gap-2 text-left text-[13px]"
                          aria-pressed={ticked.has(i)}
                        >
                          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${ticked.has(i) ? "border-leaf bg-leaf text-white" : "border-hairline"}`}>
                            {ticked.has(i) && <Check size={11} strokeWidth={3} />}
                          </span>
                          <span className={ticked.has(i) ? "text-ink-3 line-through" : "text-ink-2"}>{st.text}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
