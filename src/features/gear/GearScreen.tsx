import { Hammer, ScrollText, ShoppingBag, Swords } from "lucide-react";
import { useActiveProfile, usePack, useRules } from "../../app/context";
import { jobName } from "../../data/gameRules";
import { nextUpgrades } from "../../engine/gear";
import { apAdvice, STAT_LABEL } from "../../engine/ap";
import { Chip, EmptyState, LargeTitle, Section, Sections } from "../../ui/kit";
import { WishStar } from "../loot/LootScreen";
import { ConfidenceChip } from "../guide/parts";
import { StatAdvice } from "../stats/StatAdvice";

const HOW = { drop: { icon: Swords, label: "Monster drop" }, craft: { icon: Hammer, label: "Crafting" }, shop: { icon: ShoppingBag, label: "NPC shop" }, quest: { icon: ScrollText, label: "Quest reward" } } as const;

export function GearScreen() {
  const pack = usePack();
  const rules = useRules();
  const profile = useActiveProfile();
  if (!profile) return <EmptyState title="Pick a character to get started" />;
  if (!pack) return <EmptyState title="The guide data isn't loaded" />;
  const primary = apAdvice(profile, pack)[0]?.rest ?? null;
  const ups = nextUpgrades(profile, pack, 5, primary);
  return (
    <div className="space-y-6">
      <LargeTitle sub={`Next upgrades for a Lv ${profile.level} ${jobName(rules, profile.jobId)}`}>Gear & stats</LargeTitle>
      <StatAdvice pack={pack} profile={profile} />
      {ups.length === 0 ? (
        <EmptyState title="Gear progression isn't in the guide data yet">Upgrades by slot appear here as gear data is added and checked.</EmptyState>
      ) : (
        <Sections>
          {ups.map((u) => (
            <Section key={u.slot} value={u.slot} title={`${u.slot[0]!.toUpperCase()}${u.slot.slice(1)} · ${u.item.name}`} summary={`Lv ${u.level}`}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <WishStar profile={profile} itemId={u.item.id} />
                {u.how.map((h) => {
                  const H = HOW[h as keyof typeof HOW];
                  return (
                    <Chip key={h}>
                      <H.icon size={13} /> {H.label}
                    </Chip>
                  );
                })}
                <ConfidenceChip confidence={u.item.confidence} sources={u.item.sources} verifiedAt={u.item.verifiedAt} />
                {u.derived && <Chip tone="sky">Picked from drop data</Chip>}
                {!u.fitsBuild && primary && <Chip tone="maple">Not a {STAT_LABEL[primary]} item — check your build</Chip>}
              </div>
              {u.note && <p className="mb-2 text-sm text-ink-2">{u.note}</p>}
              {u.sources.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {u.sources.slice(0, 5).map((s) => (
                    <li key={s.mob.id} className="flex justify-between rounded-xl bg-fill px-3 py-1.5">
                      <span>
                        {s.mob.name} <span className="text-ink-3">Lv {s.mob.level}</span>
                      </span>
                      <span className="text-xs text-ink-2">{s.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ))}
        </Sections>
      )}
    </div>
  );
}
