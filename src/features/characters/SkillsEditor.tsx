import type { JobId } from "../../data/schema/profile";
import { jobLine, type GameRules } from "../../data/gameRules";
import { EmptyState, Stepper } from "../../ui/kit";

/** Minimal skill shape the editor needs; the full `Skill` type arrives with the pack schemas (P3-T1). */
export type SkillDef = { id: string; name: string; jobId: JobId; maxLevel: number };

export function skillsForJob(rules: GameRules, skills: SkillDef[], jobId: JobId): SkillDef[] {
  const line = jobLine(rules, jobId);
  line.add("beginner");
  return skills.filter((s) => line.has(s.jobId));
}

export function SkillsEditor({
  rules,
  skills,
  jobId,
  values,
  onChange,
}: {
  rules: GameRules;
  skills: SkillDef[];
  jobId: JobId;
  values: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  const list = skillsForJob(rules, skills, jobId);
  if (list.length === 0) {
    return (
      <EmptyState title="Skill details are not in the guide data yet">
        They'll appear here automatically once they've been checked against the live game.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-hairline">
      {list.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-4 py-2">
          <span>{s.name}</span>
          <Stepper
            label={`${s.name} level`}
            value={values[s.id] ?? 0}
            min={0}
            max={s.maxLevel}
            onChange={(v) => {
              const next = { ...values };
              if (v === 0) delete next[s.id];
              else next[s.id] = v;
              onChange(next);
            }}
          />
        </li>
      ))}
    </ul>
  );
}
