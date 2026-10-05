import { useState } from "react";
import { Check, Copy, Users } from "lucide-react";
import type { Pack } from "../../data/pack";
import type { Profile } from "../../data/schema/profile";
import { jobName, type GameRules } from "../../data/gameRules";
import type { Recommendation } from "../../engine/recommend";
import { Button, Chip } from "../../ui/kit";
import { toast } from "../../ui/overlays";
import { mapName } from "../guide/text";

// I-25: party helper — facts from the guide data plus a ready-to-paste recruiting message.

export function partyMessage(kind: "pq" | "spot", what: string, profile: Profile, rules: GameRules, extra = ""): string {
  const me = `Lv ${profile.level} ${jobName(rules, profile.jobId)}`;
  return kind === "pq" ? `LF party for ${what}${extra} — ${me} ready, PM me!` : `LF party to train at ${what}${extra} — ${me}, PM me!`;
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-fill px-3 py-2">
      <code className="min-w-0 flex-1 break-words text-[13px] text-ink">{text}</code>
      <Button
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast({ message: "Couldn't copy — select the text and press Ctrl+C", tone: "error" });
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function PartyHelper({ pack, rules, profile, spots }: { pack: Pack; rules: GameRules; profile: Profile; spots: Recommendation[] }) {
  const pqs = rules.partyQuests;
  return (
    <div className="space-y-5">
      {pqs.map((pq) => {
        const ok = profile.level >= pq.minLevel;
        const done = profile.unlocks.partyQuests.includes(pq.id);
        return (
          <div key={pq.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Users size={16} className="text-maple" />
              <strong>{pq.name}</strong>
              <Chip tone={ok ? "leaf" : "neutral"}>Lv {pq.minLevel}+{ok ? " — you qualify" : ` — ${pq.minLevel - profile.level} levels to go`}</Chip>
              <Chip>{pq.town}</Chip>
              {pq.finalBoss && <Chip tone="maple">Final boss: {pq.finalBoss}</Chip>}
              {done && <Chip tone="sky">Done before</Chip>}
            </div>
            {ok && <CopyLine text={partyMessage("pq", pq.name, profile, rules, ` (${pq.town})`)} />}
          </div>
        );
      })}
      {spots.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink-2">Spots good for a party at your level</p>
          {spots.slice(0, 3).map((s) => (
            <CopyLine key={s.spotId} text={partyMessage("spot", mapName(pack, s.mapId), profile, rules)} />
          ))}
        </div>
      )}
      <p className="text-xs text-ink-3">Paste it into a Megaphone, the party search or Discord. Party sizes and rules for Classic World will be added once confirmed.</p>
    </div>
  );
}
