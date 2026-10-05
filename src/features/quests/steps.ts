import type { Quest } from "../../data/schema/pack";
import type { Profile } from "../../data/schema/profile";

/** Ticks or unticks quest step `i`; all steps ticked = done, some = active (P6-T2). */
export function toggleQuestStep(p: Profile, quest: Quest, i: number): Profile {
  const set = new Set(p.questSteps[quest.id] ?? []);
  if (set.has(i)) set.delete(i);
  else set.add(i);
  const steps = [...set].sort((a, b) => a - b);
  const all = quest.steps.length > 0 && steps.length === quest.steps.length;
  const active = p.unlocks.questsActive.filter((q) => q !== quest.id);
  const doneList = p.unlocks.questsDone.filter((q) => q !== quest.id);
  return {
    ...p,
    questSteps: { ...p.questSteps, [quest.id]: steps },
    unlocks: { ...p.unlocks, questsActive: all || steps.length === 0 ? active : [...active, quest.id], questsDone: all ? [...doneList, quest.id] : doneList },
  };
}
