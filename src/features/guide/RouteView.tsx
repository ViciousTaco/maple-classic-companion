import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { CarTaxiFront, Flag, Footprints, MapPin, Ship, Sparkles } from "lucide-react";
import type { Pack } from "../../data/pack";
import type { Profile } from "../../data/schema/profile";
import { findRoute, nearestTown, type RouteStep } from "../../engine/route";
import { EmptyState, inputClass } from "../../ui/kit";
import { EntityImage } from "./EntityImage";
import { Scene } from "./parts";
import { mapName, sceneHue } from "./text";

const ICON = { portal: Footprints, taxi: CarTaxiFront, ship: Ship, hidden: Sparkles } as const;

/** "the portal on the far left, near the bottom" from the portal's position on the map picture. */
export function describePosition(pos: { x: number; y: number }): string {
  const x = pos.x < 12 ? "far left" : pos.x < 35 ? "left side" : pos.x < 65 ? "middle" : pos.x < 88 ? "right side" : "far right";
  const y = pos.y < 30 ? "near the top" : pos.y < 70 ? "halfway up" : "near the bottom";
  return `${x === "middle" ? "in the middle" : `on the ${x}`}, ${y}`;
}

export function stepText(pack: Pack, s: RouteStep): string {
  const to = mapName(pack, s.to);
  switch (s.kind) {
    case "portal":
      return s.pos ? `Take the portal ${describePosition(s.pos)} to ${to}.` : `Take the portal to ${to} (its spot on the map isn't recorded yet).`;
    case "taxi":
      return `Take the taxi to ${to}${s.costMeso ? ` — ${s.costMeso.toLocaleString("en-AU")} meso` : ""}.`;
    case "ship":
      return `Board the ship to ${to}${s.costMeso ? ` — ${s.costMeso.toLocaleString("en-AU")} meso` : ""}.`;
    case "hidden":
      return `Use the hidden passage to ${to}.`;
  }
}

/** The "from" map's picture with a glowing marker on the portal to take. */
function StepMap({ pack, step }: { pack: Pack; step: RouteStep }) {
  const map = pack.index.mapById.get(step.from);
  return (
    <div className="relative self-center overflow-hidden rounded-2xl">
      <EntityImage
        kind="map"
        id={step.from}
        name={map?.name ?? step.from}
        url={map?.image}
        editable={false}
        natural
        className="w-full rounded-2xl bg-transparent"
        fallback={<Scene hue={sceneHue(step.from)} rounded="rounded-2xl" className="aspect-[2/1] w-full" />}
      />
      {step.pos && (
        <span className="pointer-events-none absolute" style={{ left: `${step.pos.x}%`, top: `${step.pos.y}%` }}>
          <motion.span
            className="absolute -left-4 -top-4 h-8 w-8 rounded-full border-[3px] border-[#ffd84d] bg-[#ffd84d]/30"
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
          <span className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full bg-[#ffd84d] shadow-[0_0_10px_#ffd84d]" />
        </span>
      )}
    </div>
  );
}

/** P6-T3: "From [town ▾]" → numbered steps with where each portal is, taxi/ship costs and map pictures. */
export function RouteView({ pack, profile, to }: { pack: Pack; profile: Profile; to: string }) {
  const towns = useMemo(() => pack.maps.filter((m) => m.isTown).sort((a, b) => a.name.localeCompare(b.name)), [pack]);
  const [from, setFrom] = useState(() => nearestTown(pack, to)?.mapId ?? towns[0]?.id ?? "");
  const route = from ? findRoute(pack, from, to, profile.unlocks.areas) : null;
  if (!towns.length) return <EmptyState title="Map connections aren't in the guide data yet" />;
  const meso = route?.reduce((a, s) => a + (s.costMeso ?? 0), 0) ?? 0;
  return (
    <div className="space-y-4">
      <label className="flex flex-wrap items-center gap-3 text-sm font-semibold text-ink-2">
        Starting from
        <select className={`${inputClass} w-auto min-w-56`} value={from} onChange={(e) => setFrom(e.currentTarget.value)}>
          {towns.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {route && route.length > 0 && (
          <span className="font-normal text-ink-3">
            {route.length} step{route.length === 1 ? "" : "s"}
            {meso > 0 ? ` · ${meso.toLocaleString("en-AU")} meso` : ""}
          </span>
        )}
      </label>
      {route === null ? (
        <EmptyState title="No known route yet">The guide doesn't have every map connection yet.</EmptyState>
      ) : route.length === 0 ? (
        <p className="text-ink-2">You're already there.</p>
      ) : (
        <ol className="space-y-3">
          {route.map((s, i) => {
            const Icon = ICON[s.kind];
            return (
              <li key={i} className="grid gap-3 rounded-[20px] border border-hairline bg-fill p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                <StepMap pack={pack} step={s} />
                <div className="flex flex-col justify-center gap-1.5">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-ink-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-maple text-[11px] text-white">{i + 1}</span>
                    In {mapName(pack, s.from)}
                  </p>
                  <p className="flex items-start gap-2 text-[15px] leading-snug text-ink">
                    <Icon size={18} className="mt-0.5 shrink-0 text-maple-deep dark:text-maple-hi" />
                    <span>{stepText(pack, s)}</span>
                  </p>
                  {s.pos && <p className="pl-7 text-xs text-ink-3">The yellow marker shows the portal.</p>}
                </div>
              </li>
            );
          })}
          <li className="flex items-center gap-3 rounded-[20px] border border-leaf/40 bg-leaf/10 px-4 py-3 text-[15px] text-ink">
            <Flag size={18} className="text-leaf" />
            <span>
              You've arrived at <strong>{mapName(pack, to)}</strong>
              <MapPin size={14} className="ml-1 inline text-leaf" />
            </span>
          </li>
        </ol>
      )}
    </div>
  );
}
