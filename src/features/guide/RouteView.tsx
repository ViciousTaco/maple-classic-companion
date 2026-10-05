import { useMemo, useState } from "react";
import { ArrowRight, Footprints, Ship, CarTaxiFront, Sparkles } from "lucide-react";
import type { Pack } from "../../data/pack";
import type { Profile } from "../../data/schema/profile";
import { findRoute, nearestTown } from "../../engine/route";
import { EmptyState, inputClass } from "../../ui/kit";
import { mapName } from "./text";

const ICON = { portal: Footprints, taxi: CarTaxiFront, ship: Ship, hidden: Sparkles } as const;

/** P6-T3: "From [town ▾]" → numbered steps, with taxi/ship costs. */
export function RouteView({ pack, profile, to }: { pack: Pack; profile: Profile; to: string }) {
  const towns = useMemo(() => pack.maps.filter((m) => m.isTown).sort((a, b) => a.name.localeCompare(b.name)), [pack]);
  const [from, setFrom] = useState(() => nearestTown(pack, to)?.mapId ?? towns[0]?.id ?? "");
  const route = from ? findRoute(pack, from, to, profile.unlocks.areas) : null;
  if (!towns.length) return <EmptyState title="Map connections aren't in the guide data yet" />;
  const meso = route?.reduce((a, s) => a + (s.costMeso ?? 0), 0) ?? 0;
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-3 text-sm font-semibold text-ink-2">
        From
        <select className={`${inputClass} w-auto`} value={from} onChange={(e) => setFrom(e.currentTarget.value)}>
          {towns.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {route === null ? (
        <EmptyState title="No known route yet">The guide doesn't have every map connection yet.</EmptyState>
      ) : route.length === 0 ? (
        <p className="text-ink-2">You're already there.</p>
      ) : (
        <ol className="space-y-1.5">
          {route.map((s, i) => {
            const Icon = ICON[s.kind];
            return (
              <li key={i} className="flex items-center gap-3 rounded-2xl bg-fill px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-maple text-xs font-bold text-white">{i + 1}</span>
                <Icon size={16} className="shrink-0 text-ink-2" />
                <span className="min-w-0 flex-1 truncate">
                  {mapName(pack, s.from)} <ArrowRight size={13} className="inline text-ink-3" /> <strong>{mapName(pack, s.to)}</strong>
                </span>
                {s.kind !== "portal" && (
                  <span className="text-xs text-ink-2">
                    {s.kind}
                    {s.costMeso ? ` · ${s.costMeso.toLocaleString("en-AU")} meso` : ""}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {meso > 0 && <p className="text-sm text-ink-2">Travel cost: {meso.toLocaleString("en-AU")} meso</p>}
    </div>
  );
}
