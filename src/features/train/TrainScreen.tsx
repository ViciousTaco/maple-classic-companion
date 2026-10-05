import { useEffect, useState } from "react";
import { motion, useSpring, useTransform } from "motion/react";
import { AlertTriangle, Coins, Eye, Footprints, Gem, MapPin, NotebookPen, RefreshCw, RotateCcw, Scale, Shield, ShieldCheck, Sword, TrendingUp, Users } from "lucide-react";
import type { FocusId } from "../../data/schema/profile";
import type { Pack } from "../../data/pack";
import type { Recommendation } from "../../engine/recommend";
import { rateLabel } from "../../engine/rates";
import { observedDrops } from "../../engine/observed";
import { navigate, useActiveProfile, usePack, useProfileStore, useRules } from "../../app/context";
import { jobName } from "../../data/gameRules";
import { Button, Card, Chip, EmptyState, LargeTitle, Section, Sections, Segmented, spring } from "../../ui/kit";
import { Dialog } from "../../ui/overlays";
import { useQuickNote } from "../notes/QuickNote";
import { ConfidenceChip, ExternalLinkButton, Scene, useNow, useTrainingPlan } from "../guide/parts";
import { RouteView } from "../guide/RouteView";
import { EntityImage } from "../guide/EntityImage";
import { PartyHelper } from "../party/PartyHelper";
import { mapName, meowdbUrl, mobName, rangeText, reasonText, regionName, sceneHue, warningText } from "../guide/text";
import { YouTubeLite } from "../../ui/YouTubeLite";
import { questUses, TIER_ORDER, TIER_STYLE, valueTier } from "../guide/value";

export const FOCUS_SEGMENTS = [
  { value: "exp", label: <><TrendingUp size={15} />EXP</>, ariaLabel: "EXP" },
  { value: "rare-drop", label: <><Gem size={15} />Rare Item</>, ariaLabel: "Rare Item" },
  { value: "class-equip", label: <><Shield size={15} />Gear</>, ariaLabel: "Class gear" },
  { value: "meso", label: <><Coins size={15} />Meso</>, ariaLabel: "Meso" },
  { value: "balanced", label: <><Scale size={15} />Balanced</>, ariaLabel: "Balanced" },
] as { value: FocusId; label: React.ReactNode; ariaLabel: string }[];

const SKIP_MINUTES = 90;

function Ticker({ value }: { value: number }) {
  const s = useSpring(value, { stiffness: 90, damping: 20 });
  const text = useTransform(s, (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : Math.round(v).toLocaleString("en-AU")));
  useEffect(() => s.set(value), [s, value]);
  return <motion.span className="tabular-nums">{text}</motion.span>;
}

function Stat({ label, range, hint, measured }: { label: string; range: { low: number; high: number } | null; hint: string; measured?: boolean }) {
  return (
    <div className="rounded-2xl bg-fill px-3 py-2.5" title={!range ? hint : measured ? "Measured by your screen watcher (±10 %)" : "Estimate range (±20 %)"}>
      <dt className="text-xs font-semibold text-ink-3">{label}</dt>
      <dd className="font-display text-[21px] font-bold tracking-[-0.02em]">
        {range ? (
          <>
            <Ticker value={range.low} />
            <span className="text-ink-3">–</span>
            <Ticker value={range.high} />
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </dd>
    </div>
  );
}

const DANGER = {
  safe: { tone: "leaf", text: "Safe" },
  caution: { tone: "maple", text: "Careful" },
  dangerous: { tone: "maple", text: "Dangerous" },
  unknown: { tone: "neutral", text: "Danger unknown" },
} as const;

function HeroCard({ pack, rec, pinned, onTaken, onRoute, onUnpin }: { pack: Pack; rec: Recommendation; pinned: boolean; onTaken: () => void; onRoute: () => void; onUnpin: () => void }) {
  const spot = pack.index.spotById.get(rec.spotId)!;
  const map = pack.index.mapById.get(rec.mapId);
  const d = DANGER[rec.estimate.danger];
  return (
    <article className="glass grid gap-6 rounded-[30px] p-5 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]" aria-label={`Train here: ${mapName(pack, rec.mapId)}`}>
      <div className="relative min-h-44">
        <div className="absolute inset-0">
          <EntityImage
            kind="map"
            id={rec.mapId}
            name={map?.name ?? rec.mapId}
            url={map?.image}
            fit="cover"
            className="h-full w-full rounded-[22px]"
            fallback={<Scene hue={sceneHue(rec.mapId)} className="h-full w-full" />}
          />
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-end gap-2">
          {spot.mobIds.slice(0, 3).map((m) => {
            const mob = pack.index.monsterById.get(m);
            return mob ? (
              <EntityImage
                key={m}
                kind="monster"
                id={m}
                name={mob.name}
                url={mob.image}
                className="h-14 w-14 bg-white/70 p-1 backdrop-blur-md dark:bg-black/40"
                editable={false}
                hideWhenMissing
              />
            ) : null;
          })}
        </div>
        {map && (
          <span className="absolute left-3 top-3 rounded-full bg-black/35 px-3 py-1 text-xs font-semibold text-white backdrop-blur-md">
            <MapPin size={12} className="mr-1 inline" />
            {regionName(pack, map.region)}
          </span>
        )}
      </div>
      <div className="flex flex-col">
        <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-maple-deep dark:text-maple-hi">
          {pinned ? "You picked" : rec.stretch ? "Stretch pick" : "Train here now"}
        </p>
        <h2 className="mt-1 font-display text-[30px] font-bold leading-tight tracking-[-0.03em]">{mapName(pack, rec.mapId)}</h2>
        {rec.reasons[0] && <p className="mt-1.5 text-ink-2">{reasonText(pack, rec.reasons[0])}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {spot.mobIds.map((m) => (
            <Chip key={m}>
              {mobName(pack, m)} · Lv {pack.index.monsterById.get(m)?.level ?? "?"}
            </Chip>
          ))}
          <Chip tone={d.tone}>
            {rec.estimate.danger === "safe" ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />} {d.text}
          </Chip>
          <ConfidenceChip confidence={rec.confidence} sources={spot.sources} verifiedAt={spot.verifiedAt} />
          {spot.party === "either" && (
            <Chip>
              <Users size={13} /> Solo or party
            </Chip>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2.5">
          <Stat label="EXP / hour" range={rec.estimate.expPerHour} hint="Add your damage range to estimate this" measured={!!rec.estimate.observed} />
          <Stat label="Kills / hour" range={rec.estimate.killsPerHour} hint="Add your damage range to estimate this" measured={!!rec.estimate.observed} />
          <Stat label="Meso / hour" range={rec.estimate.mesoPerHour} hint="Not enough meso data for this spot yet" measured={!!rec.estimate.observed} />
        </dl>
        {rec.estimate.observed && (
          <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-leaf">
            <Eye size={14} /> Measured by your screen watcher over {Math.round(rec.estimate.observed.minutes)} min ({rec.estimate.observed.kills.toLocaleString("en-AU")} kills)
          </p>
        )}
        {rec.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-[13px] text-ink-2">
            {rec.warnings.map((w) => (
              <li key={w.code} className="flex gap-1.5">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-maple-deep dark:text-maple-hi" />
                {warningText(w)}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          {pinned ? (
            <Button size="lg" onClick={onUnpin}>
              <RotateCcw size={17} /> Back to the top pick
            </Button>
          ) : (
            <Button size="lg" variant="primary" onClick={onTaken}>
              <RefreshCw size={17} strokeWidth={2.4} />
              Map taken? Show backup
            </Button>
          )}
          <Button size="lg" onClick={onRoute}>
            <Footprints size={17} />
            How to get there
          </Button>
        </div>
      </div>
    </article>
  );
}

export function TrainScreen() {
  const pack = usePack();
  const rules = useRules();
  const profile = useActiveProfile();
  const store = useProfileStore();
  const now = useNow();
  const plan = useTrainingPlan(profile);
  const openNote = useQuickNote((s) => s.setOpen);
  const [pinned, setPinned] = useState<string | null>(null);
  const [routeTo, setRouteTo] = useState<string | null>(null);

  if (!profile) return <EmptyState title="Pick a character to get started" />;
  const update = (change: Parameters<ReturnType<typeof store.getState>["updateProfile"]>[1]) => store.getState().updateProfile(profile.id, change);
  const activeSkips = profile.skippedSpots.filter((s) => Date.parse(s.until) > now.getTime());

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <LargeTitle sub={`Best spots for Lv ${profile.level} ${jobName(rules, profile.jobId)} right now`}>Train</LargeTitle>
      <Segmented size="lg" label="Training focus" value={profile.focus} options={FOCUS_SEGMENTS} onChange={(focus) => update((p) => ({ ...p, focus }))} />
    </div>
  );

  if (!pack || !plan) return <div className="space-y-6">{header}<EmptyState title="The guide data isn't loaded" /></div>;

  const all = plan.primary ? [plan.primary, ...plan.backups] : [];
  const hero = (pinned && all.find((r) => r.spotId === pinned)) || plan.primary;
  const others = all.filter((r) => r !== hero);
  const resetSkips = () => update((p) => ({ ...p, skippedSpots: [] }));

  if (!hero) {
    return (
      <div className="space-y-6">
        {header}
        {plan.emptyReason === "all-skipped" ? (
          <EmptyState title="You've skipped every spot for your level" icon={<RefreshCw size={20} />}>
            <div className="mt-3">
              <Button onClick={resetSkips}>Reset skipped spots</Button>
            </div>
          </EmptyState>
        ) : (
          <EmptyState title={`Training data for Lv ${profile.level} is still being collected`} icon={<NotebookPen size={20} />}>
            <p>No spot is invented — this fills in as the guide data grows. You can help by noting what you see in game.</p>
            <div className="mt-3 flex justify-center gap-2">
              <Button variant="primary" onClick={() => openNote(true)}>
                <NotebookPen size={16} /> Quick note
              </Button>
              <Button onClick={() => navigate("/quests")}>See quests for your level</Button>
            </div>
          </EmptyState>
        )}
        {plan.partySpots.length > 0 && <PartySpots pack={pack} recs={plan.partySpots} />}
      </div>
    );
  }

  const spot = pack.index.spotById.get(hero.spotId)!;
  const mobs = spot.mobIds.map((id) => pack.index.monsterById.get(id)).filter((m) => m !== undefined);

  return (
    <div className="space-y-6">
      {header}

      {hero.estimate.basis === "level-band" && (
        <button
          type="button"
          onClick={() => navigate(`/characters/${profile.id}`)}
          className="flex w-full items-center gap-2 rounded-full bg-sky/12 px-4 py-2 text-left text-[13px] font-semibold text-sky hover:bg-sky/18"
        >
          <Sword size={15} /> Add your damage range (Character → Combat) for EXP / hour estimates →
        </button>
      )}

      <div className="space-y-6">
          <HeroCard
            key={hero.spotId}
            pack={pack}
            rec={hero}
            pinned={hero !== plan.primary}
            onTaken={() => {
              setPinned(null);
              update((p) => ({
                ...p,
                skippedSpots: [...p.skippedSpots.filter((s) => s.spotId !== hero.spotId), { spotId: hero.spotId, until: new Date(Date.now() + SKIP_MINUTES * 60_000).toISOString() }],
              }));
            }}
            onUnpin={() => setPinned(null)}
            onRoute={() => setRouteTo(hero.mapId)}
          />

        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="font-display text-[19px] font-semibold">Backups</h3>
            {activeSkips.length > 0 && (
              <Button size="sm" variant="ghost" onClick={resetSkips}>
                <RotateCcw size={14} /> Reset skipped spots ({activeSkips.length})
              </Button>
            )}
          </div>
          {others.length === 0 ? (
            <p className="px-1 text-sm text-ink-3">No other spot fits your level yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {others.map((b) => (
                <motion.button
                  key={b.spotId}
                  type="button"
                  transition={spring}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setPinned(b === plan.primary ? null : b.spotId)}
                  className="glass flex items-center gap-3 rounded-[22px] p-3 text-left"
                  aria-label={`Show ${mapName(pack, b.mapId)}`}
                >
                  <EntityImage
                    kind="map"
                    id={b.mapId}
                    name={mapName(pack, b.mapId)}
                    url={pack.index.mapById.get(b.mapId)?.image}
                    fit="cover"
                    editable={false}
                    className="h-16 w-20 rounded-[16px]"
                    fallback={<Scene hue={sceneHue(b.mapId)} rounded="rounded-[16px]" className="h-16 w-20" />}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{mapName(pack, b.mapId)}</p>
                    <p className="truncate text-[13px] text-ink-2">
                      {b.estimate.expPerHour ? `${rangeText(b.estimate.expPerHour)} EXP/h` : b.reasons[0] ? reasonText(pack, b.reasons[0]) : "Backup"}
                    </p>
                    {b.stretch && <span className="text-xs font-semibold text-maple-deep dark:text-maple-hi">Stretch</span>}
                    {b === plan.primary && <span className="text-xs font-semibold text-leaf">Top pick</span>}
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Sections>
        <Section value="why" title="Why this spot" summary={`compared with ${plan.considered} spot${plan.considered === 1 ? "" : "s"}`}>
          <ul className="space-y-1.5">
            {hero.reasons.map((r) => (
              <li key={r.code} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-maple" /> {reasonText(pack, r)}
              </li>
            ))}
          </ul>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {(["exp", "meso", "drop", "equip", "safety", "convenience"] as const).map((k) => (
              <div key={k} className="text-xs">
                <div className="flex justify-between text-ink-2">
                  <span className="capitalize">{k === "convenience" ? "near town" : k}</span>
                  <span className="tabular-nums">{Math.round(hero.subscores[k] * 100)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fill">
                  <motion.div className="h-full rounded-full bg-[var(--chart-1)]" initial={{ width: 0 }} animate={{ width: `${hero.subscores[k] * 100}%` }} transition={spring} />
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section value="monsters" title="Monsters" summary={mobs.map((m) => m.name).join(", ")}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-3">
              <tr>
                <th className="pb-2 font-semibold">Monster</th>
                <th className="pb-2 font-semibold">Lv</th>
                <th className="pb-2 font-semibold">HP</th>
                <th className="pb-2 font-semibold">EXP</th>
                <th className="pb-2 font-semibold">Info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {mobs.map((m) => {
                const meow = meowdbUrl("monster", m.ext?.meowdb);
                return (
                  <tr key={m.id}>
                    <td className="py-2 font-medium">
                      <span className="flex items-center gap-2">
                        <EntityImage kind="monster" id={m.id} name={m.name} url={m.image} />
                        {m.name}
                      </span>
                    </td>
                    <td className="py-2 tabular-nums">{m.level}</td>
                    <td className="py-2 tabular-nums">{m.hp.toLocaleString("en-AU")}</td>
                    <td className="py-2 tabular-nums">{m.exp.toLocaleString("en-AU")}</td>
                    <td className="py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <ConfidenceChip confidence={m.confidence} sources={m.sources} verifiedAt={m.verifiedAt} />
                        {meow && <ExternalLinkButton href={meow}>MeowDB</ExternalLinkButton>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        <Section value="drops" title="Drops" summary="best first · rates shown honestly">
          {mobs.every((m) => !(pack.index.dropsByMob.get(m.id) ?? []).length) ? (
            <p className="text-ink-2">No drops recorded for these monsters yet.</p>
          ) : (
            <>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                {(["gold", "silver", "bronze"] as const).map((t) => (
                  <span key={t} className={`rounded-full px-2 py-0.5 font-bold ${TIER_STYLE[t].chip}`}>{TIER_STYLE[t].label}</span>
                ))}
                = the guide's highest NPC sell prices (top 10 % / 25 % / 50 %) or items marked rare. Player-market prices aren't tracked.
              </p>
              <ul className="space-y-1.5 text-sm">
                {mobs
                  .flatMap((m) =>
                    (pack.index.dropsByMob.get(m.id) ?? [])
                      .filter((d) => d.status !== "legacy-unverified")
                      .map((d) => {
                        const item = pack.index.itemById.get(d.itemId);
                        return { m, d, item, tier: item ? valueTier(item, pack) : null, quests: questUses(d.itemId, pack) };
                      }),
                  )
                  .sort((a, b) => TIER_ORDER[a.tier ?? "none"]! - TIER_ORDER[b.tier ?? "none"]! || (b.item?.npcSellMeso ?? 0) - (a.item?.npcSellMeso ?? 0) || (a.item?.name ?? "").localeCompare(b.item?.name ?? ""))
                  .map(({ m, d, item, tier, quests }) => (
                    <li
                      key={`${m.id}-${d.itemId}`}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-1.5 ${tier ? TIER_STYLE[tier].row : "bg-fill"}`}
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        {tier && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TIER_STYLE[tier].chip}`}>{TIER_STYLE[tier].label}</span>}
                        <strong className="text-ink">{item?.name ?? d.itemId}</strong>
                        <span className="text-ink-2">from {m.name}</span>
                        {item?.npcSellMeso !== undefined && <span className="text-xs text-ink-2">· sells for {item.npcSellMeso.toLocaleString("en-AU")} meso</span>}
                        {quests.map((q) => (
                          <span key={q.id} className="rounded-full bg-leaf/15 px-2 py-0.5 text-[11px] font-semibold text-leaf">
                            Needed for {q.name}
                          </span>
                        ))}
                      </span>
                      <span className="text-xs text-ink-2">{rateLabel(d)}</span>
                    </li>
                  ))}
              </ul>
            </>
          )}
          {observedDrops(profile.observations[hero.spotId]).length > 0 && (
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-2">
                <Eye size={14} /> What you've picked up here (screen watcher)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {observedDrops(profile.observations[hero.spotId]).map((o) => (
                  <Chip key={o.itemId}>
                    {pack.index.itemById.get(o.itemId)?.name ?? o.itemId} · {o.drops.toLocaleString("en-AU")} in {o.kills.toLocaleString("en-AU")} kills
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </Section>

        <Section value="maps" title="Browse all maps" summary="every map by area, with pictures and routes">
          <button type="button" onClick={() => navigate("/maps")} className="font-semibold text-sky hover:underline">
            Open the map browser →
          </button>
        </Section>

        <Section value="route" title="How to get there">
          <RouteView pack={pack} profile={profile} to={hero.mapId} />
        </Section>

        <Section value="safety" title="Potions & safety" summary={DANGER[hero.estimate.danger].text}>
          <div className="space-y-2 text-sm text-ink-2">
            {hero.estimate.danger === "unknown" && <p>Add your max HP on the character sheet to see how risky this spot is.</p>}
            {spot.safeSpot && <p><strong className="text-ink">Safe spot:</strong> {spot.safeSpot}</p>}
            {spot.potionAdvice && <p><strong className="text-ink">Potions:</strong> {spot.potionAdvice}</p>}
            {spot.notes && <p>{spot.notes}</p>}
            {!spot.safeSpot && !spot.potionAdvice && !spot.notes && hero.estimate.danger !== "unknown" && <p>No extra tips recorded for this spot yet.</p>}
          </div>
        </Section>

        {spot.videoIds.length > 0 && (
          <Section value="video" title="Video" summary={`${spot.videoIds.length} guide${spot.videoIds.length === 1 ? "" : "s"}`}>
            <div className="grid gap-3">
              {spot.videoIds
                .map((id) => pack.index.videoById.get(id))
                .filter((v) => v && v.status === "ok")
                .map((v) => (
                  <YouTubeLite key={v!.id} id={v!.id} title={v!.title} />
                ))}
            </div>
          </Section>
        )}

        <Section value="party" title="Party up" summary="party quest + a ready-to-paste recruiting message">
          {plan.partySpots.length > 0 && (
            <div className="mb-4">
              <p className="mb-1 text-sm font-semibold text-ink-2">Party-only spots</p>
              <PartyList pack={pack} recs={plan.partySpots} />
            </div>
          )}
          <PartyHelper
            pack={pack}
            rules={rules}
            profile={profile}
            spots={[hero, ...others].filter((r) => pack.index.spotById.get(r.spotId)?.party !== "solo")}
          />
        </Section>
      </Sections>

      <Dialog wide open={routeTo !== null} onOpenChange={(o) => !o && setRouteTo(null)} title={`How to get to ${routeTo ? mapName(pack, routeTo) : ""}`}>
        {routeTo && <RouteView pack={pack} profile={profile} to={routeTo} />}
      </Dialog>
    </div>
  );
}

function PartyList({ pack, recs }: { pack: Pack; recs: Recommendation[] }) {
  return (
    <ul className="space-y-1.5">
      {recs.map((r) => (
        <li key={r.spotId} className="flex items-center gap-2">
          <Users size={15} className="text-ink-3" /> {mapName(pack, r.mapId)}
        </li>
      ))}
    </ul>
  );
}

function PartySpots({ pack, recs }: { pack: Pack; recs: Recommendation[] }) {
  return (
    <Card>
      <h3 className="font-display text-[19px] font-semibold">Needs a party</h3>
      <div className="mt-2">
        <PartyList pack={pack} recs={recs} />
      </div>
    </Card>
  );
}
