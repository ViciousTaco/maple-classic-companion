import { useMemo, useState } from "react";
import { Search, Star, Store, Swords } from "lucide-react";
import { useActiveProfile, usePack } from "../../app/context";
import type { GameMap } from "../../data/schema/pack";
import { Chip, EmptyState, LargeTitle, Section, Sections, inputClass } from "../../ui/kit";
import { EntityImage } from "../guide/EntityImage";
import { ConfidenceChip, Scene, useTrainingPlan } from "../guide/parts";
import { RouteView } from "../guide/RouteView";
import { mapName, mobName, regionName, sceneHue } from "../guide/text";

// P6-T5: maps by region, highlighting the recommended spot and quest targets.

export function MapsScreen() {
  const pack = usePack();
  const profile = useActiveProfile();
  const plan = useTrainingPlan(profile);
  const [q, setQ] = useState("");
  const highlights = useMemo(() => {
    const train = new Set([plan?.primary?.mapId, ...(plan?.backups.map((b) => b.mapId) ?? [])].filter(Boolean) as string[]);
    const questMaps = new Set<string>();
    if (pack && profile) {
      for (const id of profile.unlocks.questsActive) {
        const quest = pack.index.questById.get(id);
        quest?.steps.forEach((s) => s.mapId && questMaps.add(s.mapId));
        const npc = quest && pack.index.npcById.get(quest.startNpcId);
        if (npc) questMaps.add(npc.mapId);
      }
    }
    return { train, questMaps };
  }, [pack, profile, plan]);

  if (!pack || !profile) return <EmptyState title="The guide data isn't loaded" />;
  const needle = q.trim().toLowerCase();
  const levelRange = (m: GameMap) => {
    const lv = m.spawns.map((s) => pack.index.monsterById.get(s.mobId)?.level).filter((x): x is number => x !== undefined);
    return lv.length ? [Math.min(...lv), Math.max(...lv)] : null;
  };
  const matches = (m: GameMap) =>
    !needle || m.name.toLowerCase().includes(needle) || m.spawns.some((s) => mobName(pack, s.mobId).toLowerCase().includes(needle));
  const regions = pack.meta.regionsAvailable.map((r) => ({
    id: r,
    maps: pack.maps
      .filter((m) => m.region === r && matches(m))
      .sort((a, b) => Number(b.isTown) - Number(a.isTown) || (levelRange(a)?.[0] ?? 0) - (levelRange(b)?.[0] ?? 0) || a.name.localeCompare(b.name)),
  }));

  return (
    <div className="space-y-6">
      <LargeTitle sub="Every map in the guide — towns first, then by monster level">Maps</LargeTitle>
      <label className="relative block">
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
        <input className={`${inputClass} rounded-full pl-11`} placeholder="Search maps or monsters…" value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label="Search maps or monsters" />
      </label>
      {regions.map((r) => (
        <section key={r.id} className="space-y-3">
          <h3 className="px-1 font-display text-[20px] font-semibold">
            {regionName(pack, r.id)} <span className="text-sm font-normal text-ink-3">· {r.maps.length} maps</span>
          </h3>
          {r.maps.length === 0 ? (
            <p className="px-1 text-sm text-ink-3">No maps match.</p>
          ) : (
            <Sections>
              {r.maps.slice(0, needle ? 60 : 200).map((m) => {
                const lv = levelRange(m);
                const train = highlights.train.has(m.id);
                const quest = highlights.questMaps.has(m.id);
                return (
                  <Section
                    key={m.id}
                    value={m.id}
                    title={`${train ? "★ " : ""}${m.name}`}
                    summary={[m.isTown ? "Town" : lv ? `Lv ${lv[0]}${lv[1] !== lv[0] ? `–${lv[1]}` : ""}` : "", train ? "your training spot" : "", quest ? "quest target" : ""].filter(Boolean).join(" · ")}
                  >
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <EntityImage
                        kind="map"
                        id={m.id}
                        name={m.name}
                        url={m.image}
                        fit="cover"
                        className="h-48 w-full rounded-[18px]"
                        fallback={<Scene hue={sceneHue(m.id)} rounded="rounded-[18px]" className="h-48 w-full" />}
                      />
                      <div className="space-y-3 text-sm">
                        <div className="flex flex-wrap gap-1.5">
                          {m.isTown && <Chip tone="sky">Town</Chip>}
                          {m.hasPotionShop && (
                            <Chip>
                              <Store size={12} /> Potions
                            </Chip>
                          )}
                          {train && (
                            <Chip tone="maple">
                              <Star size={12} /> Recommended for you
                            </Chip>
                          )}
                          {quest && (
                            <Chip tone="leaf">
                              <Swords size={12} /> Quest target
                            </Chip>
                          )}
                          <ConfidenceChip confidence={m.confidence} sources={m.sources} verifiedAt={m.verifiedAt} />
                        </div>
                        {m.spawns.length > 0 && (
                          <p>
                            <strong>Monsters:</strong>{" "}
                            {m.spawns
                              .map((s) => `${mobName(pack, s.mobId)} (Lv ${pack.index.monsterById.get(s.mobId)?.level ?? "?"})${s.count ? ` ×${s.count}` : ""}`)
                              .join(", ")}
                          </p>
                        )}
                        {m.links.length > 0 && (
                          <p>
                            <strong>Leads to:</strong> {m.links.map((l) => `${mapName(pack, l.to)}${l.kind !== "portal" ? ` (${l.kind})` : ""}`).join(", ")}
                          </p>
                        )}
                        {m.npcIds.length > 0 && (
                          <p>
                            <strong>NPCs:</strong> {m.npcIds.map((n) => pack.index.npcById.get(n)?.name ?? n).join(", ")}
                          </p>
                        )}
                        {!m.isTown && (
                          <details className="rounded-2xl bg-fill px-3 py-2">
                            <summary className="cursor-pointer font-semibold">How to get there</summary>
                            <div className="mt-3">
                              <RouteView pack={pack} profile={profile} to={m.id} />
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  </Section>
                );
              })}
            </Sections>
          )}
        </section>
      ))}
    </div>
  );
}
