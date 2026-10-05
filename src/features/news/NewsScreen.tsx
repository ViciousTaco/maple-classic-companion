import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { CalendarClock, ExternalLink, Newspaper, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { usePack, usePlatform, useProfiles } from "../../app/context";
import type { GameEvent } from "../../data/schema/pack";
import { convertedReferences, formatWhen, SYDNEY } from "../../lib/sydney";
import { Button, Chip, EmptyState, LargeTitle, Segmented, spring } from "../../ui/kit";
import { Dialog } from "../../ui/overlays";
import { relativeTime } from "../characters/hooks";
import { endingSoon, eventState, stateLabel, type EventState } from "../events/events";
import { useNow } from "../guide/parts";
import { dateReferences } from "./core";
import { annotateArticles, type AssessedArticle } from "./relevance";
import type { Article } from "./schema";
import { useNews } from "./store";

type Tab = "now" | "upcoming" | "past" | "review";
type Assessed = AssessedArticle<Article>;

/** P7-T5: a seed event whose article changed since it was entered. */
export function changedEvents(events: GameEvent[], articles: Article[]): Set<string> {
  const byId = new Map(articles.map((a) => [a.id, a]));
  return new Set(events.filter((e) => byId.has(e.articleId) && byId.get(e.articleId)!.contentHash !== e.articleHash).map((e) => e.id));
}

function EventRow({ s, now, changed, tz }: { s: EventState; now: Date; changed: boolean; tz: string | undefined }) {
  const platform = usePlatform();
  const e = s.event;
  return (
    <motion.li layout className="glass rounded-[22px] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold">{e.title}</p>
          <p className="mt-0.5 text-sm text-ink-2" title={s.at ? `Source time (UTC): ${s.at.replace("T", " ").replace(":00Z", " UTC")}` : undefined}>
            {stateLabel(s, now)}
            {s.at && <> · {formatWhen(s.at, tz)}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {s.status === "now" && <Chip tone="leaf">Live</Chip>}
          {e.minLevel && <Chip>Lv {e.minLevel}+</Chip>}
          {e.kind === "gm-event" && <Chip tone="sky">GM event</Chip>}
          {changed && (
            <Chip tone="maple">
              <TriangleAlert size={12} /> Details changed — check the article
            </Chip>
          )}
        </div>
      </div>
      {e.windows.length > 1 && (
        <p className="mt-2 text-xs text-ink-3">
          {e.windows.length} sessions:{" "}
          {e.windows
            .map((w) => formatWhen(w.startUtc, tz).replace(/^\w+ /, ""))
            .slice(0, 5)
            .join(" · ")}
        </p>
      )}
      {e.howTo && <p className="mt-2 text-sm text-ink-2">{e.howTo}</p>}
      {e.rewards && <p className="mt-1 text-sm text-ink-2"><strong className="text-ink">Rewards:</strong> {e.rewards}</p>}
      <button type="button" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-sky hover:underline" onClick={() => void platform.openUrl(e.sources[0]?.url ?? `https://www.nexon.com/maplestory/news/general/${e.articleId}`)}>
        Official article <ExternalLink size={13} />
      </button>
    </motion.li>
  );
}

function ArticleRow({ a, onOpen }: { a: Assessed; onOpen: () => void }) {
  return (
    <motion.li layout>
      <button type="button" onClick={onOpen} className="glass flex w-full items-start gap-3 rounded-[22px] p-4 text-left transition hover:-translate-y-0.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fill text-ink-2">
          <Newspaper size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug">{a.title}</span>
          <span className="mt-0.5 block text-xs text-ink-3">
            {a.type} · {formatWhen(a.publishedUTC, SYDNEY).replace(/, \d{1,2}:\d{2}.*$/, "")}
            {a.change === "New" && <span className="ml-2 font-bold text-leaf">NEW</span>}
            {a.change === "Updated" && <span className="ml-2 font-bold text-sky">UPDATED</span>}
          </span>
          {a.summary && <span className="mt-1 line-clamp-2 block text-sm text-ink-2">{a.summary}</span>}
        </span>
        <Chip tone={a.relevance.status === "Needs review" ? "maple" : a.relevance.bucket === "current" ? "leaf" : "neutral"}>{a.relevance.status}</Chip>
      </button>
    </motion.li>
  );
}

function Reader({ a, tz, onClose }: { a: Assessed | null; tz: string | undefined; onClose: () => void }) {
  const platform = usePlatform();
  const times = useMemo(() => (a ? convertedReferences(dateReferences(a)).filter((r) => r.utc) : []), [a]);
  return (
    <Dialog open={a !== null} onOpenChange={(o) => !o && onClose()} title={a?.title ?? ""} description={a ? `${a.type} · published ${formatWhen(a.publishedUTC, tz)}` : undefined} wide>
      {a && (
        <div className="space-y-4">
          <p className="rounded-2xl bg-fill px-3 py-2 text-sm text-ink-2">
            <strong className="text-ink">{a.relevance.status}:</strong> {a.relevance.reason}
          </p>
          {times.length > 0 && (
            <div className="rounded-2xl bg-sky/10 px-3 py-2 text-sm">
              <p className="mb-1 font-semibold text-sky">Times in your zone</p>
              <ul className="space-y-0.5">
                {times.slice(0, 12).map((t, i) => (
                  <li key={i}>
                    <span className="text-ink-3">{t.parsedSource}</span> → <strong>{formatWhen(t.utc!, tz)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-2xl bg-fill p-4 text-sm leading-relaxed">{a.body}</div>
          <Button variant="primary" onClick={() => void platform.openUrl(a.url)}>
            Open on nexon.com <ExternalLink size={15} />
          </Button>
        </div>
      )}
    </Dialog>
  );
}

export function NewsScreen() {
  const pack = usePack();
  const now = useNow();
  const tz = useProfiles((s) => s.file.settings.timeZoneMode) === "sydney" ? SYDNEY : undefined;
  const { result, status, lastAttempt, refresh } = useNews();
  const [tab, setTab] = useState<Tab>("now");
  const [open, setOpen] = useState<Assessed | null>(null);

  const articles = useMemo<Assessed[]>(
    () => (result && pack ? annotateArticles(result.articles, pack.newsRules, now.toISOString()).sort((a, b) => Date.parse(b.publishedUTC) - Date.parse(a.publishedUTC)) : []),
    [result, pack, now],
  );
  const events = useMemo(() => (pack ? pack.events.map((e) => eventState(e, now)) : []), [pack, now]);
  const changed = useMemo(() => (pack && result ? changedEvents(pack.events, result.articles) : new Set<string>()), [pack, result]);

  const lists = {
    now: { events: events.filter((s) => s.status === "now"), articles: articles.filter((a) => a.relevance.bucket === "current" && a.relevance.status !== "Needs review") },
    upcoming: { events: endingSoon(pack?.events ?? [], now, 365).filter((s) => s.status === "upcoming"), articles: [] as Assessed[] },
    past: { events: events.filter((s) => s.status === "ended"), articles: articles.filter((a) => a.relevance.bucket === "archive") },
    review: { events: [] as EventState[], articles: articles.filter((a) => a.relevance.status === "Needs review") },
  }[tab];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <LargeTitle
          sub={
            <>
              Official Nexon news for Classic World · times in {tz ? "Sydney" : "your PC's"} time
              {result?.fetchedAt && <> · checked {relativeTime(lastAttempt ?? result.fetchedAt, now)}</>}
            </>
          }
        >
          News & events
        </LargeTitle>
        <Button onClick={() => void refresh()} disabled={status === "checking"}>
          <RefreshCw size={16} className={status === "checking" ? "animate-spin" : ""} /> {status === "checking" ? "Checking…" : "Check now"}
        </Button>
      </div>

      {status === "offline" && (
        <div role="status" className="glass flex items-start gap-2 rounded-2xl px-4 py-3 text-sm text-maple-deep dark:text-maple-hi">
          <WifiOff size={16} className="mt-0.5 shrink-0" />
          <span>
            Couldn't reach Nexon just now — showing the last saved news{result?.fetchedAt ? ` from ${formatWhen(result.fetchedAt, tz)}` : ""}. {result?.problems[0]}
          </span>
        </div>
      )}

      <Segmented
        size="lg"
        label="News view"
        value={tab}
        onChange={setTab}
        options={[
          { value: "now", label: "Now" },
          { value: "upcoming", label: "Upcoming" },
          { value: "past", label: "Past" },
          { value: "review", label: `Needs review${articles.some((a) => a.relevance.status === "Needs review") ? ` (${articles.filter((a) => a.relevance.status === "Needs review").length})` : ""}` , ariaLabel: "Needs review" },
        ]}
      />

      {lists.events.length + lists.articles.length === 0 ? (
        <EmptyState title={result === null && status === "checking" ? "Fetching the latest news…" : "Nothing here right now"} icon={<CalendarClock size={20} />} />
      ) : (
        <motion.ul layout transition={spring} className="space-y-3">
          {lists.events.map((s) => (
            <EventRow key={s.event.id} s={s} now={now} changed={changed.has(s.event.id)} tz={tz} />
          ))}
          {lists.articles.map((a) => (
            <ArticleRow key={a.id} a={a} onOpen={() => setOpen(a)} />
          ))}
        </motion.ul>
      )}
      <Reader a={open} tz={tz} onClose={() => setOpen(null)} />
    </div>
  );
}
