import { motion } from "motion/react";
import { ArrowRight, Dumbbell, Shield } from "lucide-react";
import type { Pack } from "../../data/pack";
import type { Profile } from "../../data/schema/profile";
import { apAdvice, gearStatNeeds, STAT_LABEL } from "../../engine/ap";
import { Chip, spring } from "../../ui/kit";
import { ConfidenceChip } from "../guide/parts";

/** "Where to put your stat points" — from sourced AP builds and the next upgrades' stat requirements. */
export function StatAdvice({ pack, profile, compact = false }: { pack: Pack | null; profile: Profile; compact?: boolean }) {
  if (!pack) return null;
  const advice = apAdvice(profile, pack);
  const needs = gearStatNeeds(profile, pack);
  const main = advice[0];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="space-y-3 rounded-[22px] bg-fill p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-maple/14 text-maple-deep dark:text-maple-hi">
          <Dumbbell size={18} />
        </span>
        <p className="font-display text-[17px] font-semibold">Where to put your stat points</p>
      </div>
      {!main ? (
        <p className="text-sm text-ink-2">
          No stat build for your class at Lv {profile.level} is in the guide data yet — it's added from checked class guides. Nothing is guessed.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[15px]">
            {main.steps.map((s) => (
              <span key={s.stat} className="flex items-center gap-1.5">
                <strong>{STAT_LABEL[s.stat]}</strong>
                {s.add === null ? (
                  <span className="text-ink-2">to {s.target}</span>
                ) : s.add > 0 ? (
                  <span className="text-ink-2">
                    +{s.add} <span className="text-ink-3">(to {s.target})</span>
                  </span>
                ) : (
                  <span className="text-leaf">✓ {s.current}</span>
                )}
                <ArrowRight size={14} className="text-ink-3" />
              </span>
            ))}
            <span>
              everything else into <strong className="text-maple-deep dark:text-maple-hi">{STAT_LABEL[main.rest]}</strong>
            </span>
          </div>
          {!compact && <p className="text-sm text-ink-2">{main.phase.text}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Chip>{main.build.name}</Chip>
            {!main.exact && <Chip tone="sky">From your earlier job's guide</Chip>}
            <ConfidenceChip confidence={main.build.confidence} sources={main.build.sources} verifiedAt={main.build.verifiedAt} />
          </div>
          {main.steps.some((s) => s.current === null) && <p className="text-xs text-ink-3">Add your stats on the character sheet to see exactly how many points to add.</p>}
          {!compact && main.nextPhase && (
            <p className="text-xs text-ink-3">
              From Lv {main.nextPhase.fromLevel}: {main.nextPhase.text}
            </p>
          )}
          {!compact && advice.length > 1 && <p className="text-xs text-ink-3">Other builds: {advice.slice(1).map((a) => a.build.name).join(", ")}</p>}
        </>
      )}
      {needs.length > 0 && (
        <ul className="space-y-1 border-t border-hairline pt-3 text-sm">
          <li className="text-xs font-semibold text-ink-3">Your next gear needs</li>
          {[...new Map(needs.map((n) => [n.item.id, needs.filter((x) => x.item.id === n.item.id)])).values()].slice(0, compact ? 2 : 5).map((group) => (
            <li key={group[0]!.item.id} className="flex items-center gap-2">
              <Shield size={14} className="shrink-0 text-ink-3" />
              <span>
                <strong>{group[0]!.item.name}</strong> (Lv {group[0]!.level}) ·{" "}
                {group.map((n, i) => (
                  <span key={n.stat}>
                    {i > 0 && " · "}
                    {n.need} {STAT_LABEL[n.stat]}
                    {n.short ? <span className="text-maple-deep dark:text-maple-hi"> ({n.short} more)</span> : ""}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}
