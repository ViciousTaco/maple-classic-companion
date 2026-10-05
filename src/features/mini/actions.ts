import type { Pack } from "../../data/pack";
import type { Profile } from "../../data/schema/profile";
import { toggleQuestStep } from "../quests/steps";

// I-24: the mini window never saves. It asks the main window (the single writer, §8.2) to make changes.

export type MiniAction =
  | { kind: "skip-spot"; payload: { profileId: string; spotId: string } }
  | { kind: "quest-step"; payload: { profileId: string; questId: string; step: number } }
  | { kind: "watch-toggle"; payload: Record<string, never> };

export const SKIP_MINUTES = 90;

/** Accepts `{kind, payload}` as relayed by Rust; anything else is ignored. */
export function parseMiniAction(raw: unknown): MiniAction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { kind?: unknown; payload?: unknown };
  const p = (r.payload ?? {}) as Record<string, unknown>;
  if (r.kind === "skip-spot" && typeof p.profileId === "string" && typeof p.spotId === "string")
    return { kind: "skip-spot", payload: { profileId: p.profileId, spotId: p.spotId } };
  if (r.kind === "quest-step" && typeof p.profileId === "string" && typeof p.questId === "string" && Number.isInteger(p.step))
    return { kind: "quest-step", payload: { profileId: p.profileId, questId: p.questId, step: p.step as number } };
  if (r.kind === "watch-toggle") return { kind: "watch-toggle", payload: {} };
  return null;
}

/** The profile change a mini action asks for (null = nothing to change). */
export function profileChange(a: MiniAction, pack: Pack | null, now: Date): ((p: Profile) => Profile) | null {
  switch (a.kind) {
    case "skip-spot": {
      const until = new Date(now.getTime() + SKIP_MINUTES * 60_000).toISOString();
      return (p) => ({ ...p, skippedSpots: [...p.skippedSpots.filter((s) => s.spotId !== a.payload.spotId), { spotId: a.payload.spotId, until }] });
    }
    case "quest-step": {
      const quest = pack?.index.questById.get(a.payload.questId);
      if (!quest || a.payload.step < 0 || a.payload.step >= quest.steps.length) return null;
      return (p) => toggleQuestStep(p, quest, a.payload.step);
    }
    case "watch-toggle":
      return null;
  }
}
