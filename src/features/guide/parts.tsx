import { useEffect, useMemo, useState } from "react";
import { Popover } from "radix-ui";
import { BadgeCheck, CircleHelp, ExternalLink, ShieldQuestion } from "lucide-react";
import type { Confidence, Source } from "../../data/schema/pack";
import { usePack, usePlatform } from "../../app/context";
import { recommendTraining, type TrainingPlan } from "../../engine/recommend";
import type { Profile } from "../../data/schema/profile";
import { CONFIDENCE_LABEL } from "./text";

/** Ticks every `ms` so time-based views (skip lists, countdowns) stay current. */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useTrainingPlan(profile: Profile | null): TrainingPlan | null {
  const pack = usePack();
  const now = useNow();
  return useMemo(() => (pack && profile ? recommendTraining({ profile, pack, now }) : null), [pack, profile, now]);
}

export function ExternalLinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  const platform = usePlatform();
  return (
    <button
      type="button"
      onClick={() => void platform.openUrl(href)}
      className="inline-flex items-center gap-1 font-semibold text-sky hover:underline"
    >
      {children}
      <ExternalLink size={13} />
    </button>
  );
}

const TONE: Record<Confidence, string> = {
  verified: "bg-leaf/14 text-leaf",
  likely: "bg-sky/14 text-sky",
  unverified: "bg-maple/14 text-maple-deep dark:text-maple-hi",
};

/** Plan §6.2: a small chip; tapping it reveals the sources and dates. */
export function ConfidenceChip({ confidence, sources, verifiedAt }: { confidence: Confidence; sources: Source[]; verifiedAt?: string }) {
  const Icon = confidence === "verified" ? BadgeCheck : confidence === "likely" ? CircleHelp : ShieldQuestion;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${CONFIDENCE_LABEL[confidence]} — show sources`}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition hover:brightness-110 ${TONE[confidence]}`}
        >
          <Icon size={13} />
          {CONFIDENCE_LABEL[confidence]}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={8} className="glass-strong z-50 w-80 rounded-2xl p-4 text-sm shadow-xl">
          <p className="font-semibold">Where this comes from</p>
          <ul className="mt-2 space-y-2">
            {sources.map((s, i) => (
              <li key={i} className="text-ink-2">
                <span className="block text-ink">{s.label}</span>
                <span className="text-xs">
                  {s.kind === "in-game" ? "Seen in game" : s.kind === "official" ? "Official Nexon" : s.kind === "community" ? "Community source" : "Old (legacy) source"} ·
                  checked {s.retrievedAt.slice(0, 10)}
                </span>
                {s.url && (
                  <span className="block">
                    <ExternalLinkButton href={s.url}>Open source</ExternalLinkButton>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {verifiedAt && <p className="mt-2 text-xs text-ink-3">Last reviewed {verifiedAt.slice(0, 10)}</p>}
          <Popover.Arrow className="fill-[var(--glass-strong)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Soft illustrated map tile — original artwork, no game assets. */
export function Scene({ hue, rounded = "rounded-[22px]", className = "" }: { hue: [string, string, string]; rounded?: string; className?: string }) {
  const [sky, mid, ground] = hue;
  return (
    <div className={`relative overflow-hidden ${rounded} ${className}`} style={{ background: `linear-gradient(170deg, ${sky}, ${mid})` }}>
      <svg viewBox="0 0 200 120" className="block h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <circle cx="160" cy="28" r="14" fill="#fff" opacity="0.55" />
        <ellipse cx="40" cy="30" rx="26" ry="7" fill="#fff" opacity="0.35" />
        <path d="M0 80 Q 50 52 100 74 T 200 66 V120 H0Z" fill={ground} opacity="0.55" />
        <path d="M0 96 Q 60 74 120 92 T 200 88 V120 H0Z" fill={ground} />
        <circle cx="62" cy="88" r="5" fill="#fff" opacity="0.8" />
        <circle cx="132" cy="96" r="4" fill="#fff" opacity="0.7" />
      </svg>
    </div>
  );
}
