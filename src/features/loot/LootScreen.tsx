import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Search, Star } from "lucide-react";
import type { Pack } from "../../data/pack";
import { ownDropRate } from "../../engine/observed";
import { ownRateLabel } from "../../engine/rates";
import type { Item } from "../../data/schema/pack";
import type { Profile } from "../../data/schema/profile";
import { useActiveProfile, usePack, useProfileStore } from "../../app/context";
import { bestLootTargets, findDropSources } from "../../engine/loot";
import { Chip, EmptyState, LargeTitle, Section, Sections, inputClass, spring } from "../../ui/kit";
import { ConfidenceChip, ExternalLinkButton } from "../guide/parts";
import { EntityImage } from "../guide/EntityImage";
import { questUses, TIER_STYLE, valueTier } from "../guide/value";
import { mapName, meowdbUrl } from "../guide/text";

export function WishStar({ profile, itemId }: { profile: Profile; itemId: string }) {
  const store = useProfileStore();
  const on = profile.wishlistItemIds.includes(itemId);
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Remove from wishlist" : "Add to wishlist"}
      title={on ? "On your wishlist" : "Add to wishlist"}
      whileTap={{ scale: 0.75, rotate: -15 }}
      transition={spring}
      onClick={() =>
        store.getState().updateProfile(profile.id, (p) => ({
          ...p,
          wishlistItemIds: on ? p.wishlistItemIds.filter((x) => x !== itemId) : [...p.wishlistItemIds, itemId],
        }))
      }
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${on ? "bg-[#ffcc00]/25 text-[#d99a00]" : "bg-fill text-ink-3 hover:text-ink-2"}`}
    >
      <Star size={16} fill={on ? "currentColor" : "none"} />
    </motion.button>
  );
}

function Sources({ pack, item, profile }: { pack: Pack; item: Item; profile: Profile }) {
  const sources = findDropSources(pack, item.id);
  if (!sources.length) return <p className="text-sm text-ink-3">No known monster drops it yet.</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {sources.map((s) => (
        <li key={s.mob.id} className="rounded-xl bg-fill px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>{s.mob.name}</strong> <span className="text-ink-3">Lv {s.mob.level}</span>
            </span>
            <span className="text-xs text-ink-2">
              {s.label}
              {(() => {
                const own = ownRateLabel(ownDropRate(pack, profile.observations, s.mob.id, item.id));
                return own ? <span className="ml-2 font-semibold text-leaf">{own}</span> : null;
              })()}
            </span>
          </div>
          {s.mapIds.length > 0 && <p className="mt-0.5 text-xs text-ink-3">Found in {s.mapIds.slice(0, 4).map((m) => mapName(pack, m)).join(", ")}{s.mapIds.length > 4 ? "…" : ""}</p>}
        </li>
      ))}
    </ul>
  );
}

function ItemRow({ pack, profile, item }: { pack: Pack; profile: Profile; item: Item }) {
  const meow = meowdbUrl("item", item.ext?.meowdb);
  return (
    <Section value={item.id} title={item.name} summary={[item.category, item.reqLevel ? `Lv ${item.reqLevel}` : null, item.reqJobs?.join("/")].filter(Boolean).join(" · ")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <EntityImage kind="item" id={item.id} name={item.name} url={item.image} className="h-12 w-12" />
        <WishStar profile={profile} itemId={item.id} />
        <ConfidenceChip confidence={item.confidence} sources={item.sources} verifiedAt={item.verifiedAt} />
        {(() => {
          const tier = valueTier(item, pack);
          return tier ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${TIER_STYLE[tier].chip}`}>{TIER_STYLE[tier].label}</span> : null;
        })()}
        {item.rarity && <Chip tone="maple">{item.rarity.replace("-", " ")}</Chip>}
        {questUses(item.id, pack).map((q) => (
          <Chip key={q.id} tone="leaf">
            Needed for {q.name}
          </Chip>
        ))}
        {item.npcSellMeso !== undefined && <Chip>Sells for {item.npcSellMeso.toLocaleString("en-AU")} meso</Chip>}
        {meow && <ExternalLinkButton href={meow}>MeowDB</ExternalLinkButton>}
      </div>
      {item.stats && (
        <p className="mb-3 text-sm text-ink-2">
          {Object.entries(item.stats)
            .map(([k, v]) => `${k.toUpperCase()} ${v > 0 ? "+" : ""}${v}`)
            .join(" · ")}
        </p>
      )}
      <Sources pack={pack} item={item} profile={profile} />
    </Section>
  );
}

export function LootScreen({ initialQuery = "" }: { initialQuery?: string }) {
  const pack = usePack();
  const profile = useActiveProfile();
  const [q, setQ] = useState(initialQuery);
  const results = useMemo(() => {
    if (!pack || q.trim().length < 2) return [];
    const needle = q.trim().toLowerCase();
    return pack.items.filter((i) => i.name.toLowerCase().includes(needle)).slice(0, 25);
  }, [pack, q]);
  if (!profile) return <EmptyState title="Pick a character to get started" />;
  if (!pack) return <EmptyState title="The guide data isn't loaded" />;
  const targets = bestLootTargets(profile, pack);
  const wish = profile.wishlistItemIds.map((id) => pack.index.itemById.get(id)).filter((i) => i !== undefined);
  const WHY = { wishlist: "On your wishlist", "class-equip": "Gear for your class", rare: "Rare find" } as const;

  return (
    <div className="space-y-6">
      <LargeTitle sub={`Worth hunting at Lv ${profile.level}`}>Loot</LargeTitle>
      <label className="relative block">
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
        <input className={`${inputClass} rounded-full pl-11`} placeholder="Search items…" value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label="Search items" />
      </label>

      {q.trim().length >= 2 ? (
        results.length ? (
          <Sections>{results.map((i) => <ItemRow key={i.id} pack={pack} profile={profile} item={i} />)}</Sections>
        ) : (
          <EmptyState title={`No items match "${q}"`} />
        )
      ) : (
        <>
          <section>
            <h3 className="mb-2 px-1 font-display text-[19px] font-semibold">Best targets for you</h3>
            {targets.length === 0 ? (
              <EmptyState title="No standout drops for your level in the guide data yet" />
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {targets.map((t, i) => (
                  <motion.div
                    key={t.item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...spring, delay: i * 0.06 }}
                    className="glass flex flex-col gap-2 rounded-[24px] p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <EntityImage kind="item" id={t.item.id} name={t.item.name} url={t.item.image} className="h-11 w-11" />
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-[18px] font-semibold leading-tight">{t.item.name}</p>
                        <p className="text-xs text-ink-3">{WHY[t.why]}</p>
                      </div>
                      <WishStar profile={profile} itemId={t.item.id} />
                    </div>
                    {t.sources[0] && (
                      <p className="text-sm text-ink-2">
                        {t.sources[0].mob.name} (Lv {t.sources[0].mob.level}) · <span className="text-xs">{t.sources[0].label}</span>
                      </p>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </section>
          <section>
            <h3 className="mb-2 px-1 font-display text-[19px] font-semibold">Wishlist</h3>
            {wish.length === 0 ? (
              <EmptyState title="Star items to track where they drop" icon={<Star size={20} />} />
            ) : (
              <Sections>{wish.map((i) => <ItemRow key={i.id} pack={pack} profile={profile} item={i} />)}</Sections>
            )}
          </section>
        </>
      )}
    </div>
  );
}
