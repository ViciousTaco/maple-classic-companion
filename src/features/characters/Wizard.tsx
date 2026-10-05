import { useState } from "react";
import type { FocusId, JobId, Profile } from "../../data/schema/profile";
import { jobLine, jobsForLevel, type JobFamily } from "../../data/gameRules";
import { usePlatform, useProfileStore, useRules } from "../../app/context";
import { Button, Field, Segmented, Stepper, inputClass } from "../../ui/kit";
import { toast } from "../../ui/overlays";
import { ScreenshotPicker } from "./ScreenshotPicker";
import { FOCUS_OPTIONS, saveScreenshot } from "./hooks";

const FAMILIES: { value: JobFamily; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "warrior", label: "Warrior" },
  { value: "magician", label: "Magician" },
  { value: "bowman", label: "Bowman" },
  { value: "thief", label: "Thief" },
];

const FOCUS_HELP: Record<FocusId, string> = {
  exp: "Level up as fast as possible.",
  "rare-drop": "Hunt for rare items.",
  "class-equip": "Find gear for your class.",
  meso: "Make the most money.",
  balanced: "A bit of everything — a good default.",
};

/** Jobs the wizard offers: the chosen class line at this level, or Beginner if the class isn't reachable yet. */
export function wizardJobs(rules: Parameters<typeof jobsForLevel>[0], family: JobFamily, level: number) {
  const line = jobLine(rules, family as JobId);
  const options = jobsForLevel(rules, level).filter((j) => line.has(j.id));
  return options.length ? options : jobsForLevel(rules, level).filter((j) => j.id === "beginner");
}

export function Wizard({ onDone, onCancel }: { onDone: (p: Profile) => void; onCancel?: () => void }) {
  const rules = useRules();
  const store = useProfileStore();
  const platform = usePlatform();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [family, setFamily] = useState<JobFamily>("beginner");
  const [level, setLevel] = useState(1);
  const [jobId, setJobId] = useState<JobId>("beginner");
  const [focus, setFocus] = useState<FocusId>("balanced");
  const [shot, setShot] = useState<Uint8Array | null>(null);

  const jobs = wizardJobs(rules, family, level);
  const effectiveJob = jobs.some((j) => j.id === jobId)
    ? jobId
    : (jobs.find((j) => j.id === family)?.id ?? jobs[0]?.id ?? "beginner");
  const nameOk = name.trim().length > 0 && name.trim().length <= 24;
  const firstJobLevel = rules.jobAdvancements.find((a) => a.to.includes(family as JobId))?.level;

  const finish = async () => {
    const profile = store.getState().createProfile({ name: name.trim(), jobId: effectiveJob, level, focus });
    if (shot) {
      try {
        await saveScreenshot(platform, store, profile.id, shot);
      } catch (err) {
        toast({ message: `Character saved, but the picture couldn't be: ${String(err)}`, tone: "error" });
      }
    }
    onDone(profile);
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <ol className="flex gap-2 text-sm" aria-label="Steps">
        {["Who", "Level & job", "Focus"].map((label, i) => (
          <li
            key={label}
            aria-current={step === i + 1 ? "step" : undefined}
            className={`flex-1 rounded-full px-3 py-1 text-center ${
              step === i + 1 ? "bg-maple text-white" : step > i + 1 ? "bg-leaf/15 text-leaf" : "bg-fill text-ink-3"
            }`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-5">
          <Field label="Character name">
            {(id) => (
              <input
                id={id}
                className={inputClass}
                value={name}
                maxLength={24}
                autoFocus
                placeholder="As shown in game"
                onChange={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && nameOk && setStep(2)}
              />
            )}
          </Field>
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink-2">Class</p>
            <Segmented label="Class" value={family} options={FAMILIES} onChange={setFamily} />
          </div>
          <details className="rounded-xl border border-hairline glass p-3 text-sm">
            <summary className="cursor-pointer font-medium">Add a screenshot (optional)</summary>
            <div className="mt-3">
              <ScreenshotPicker bytes={shot} onBytes={setShot} onRemove={() => setShot(null)} />
            </div>
          </details>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink-2">Level</p>
            <Stepper label="Level" value={level} min={1} max={rules.levelCap} onChange={setLevel} />
          </div>
          <Field
            label="Job"
            warning={
              family !== "beginner" && firstJobLevel && level < firstJobLevel
                ? `You can become a ${FAMILIES.find((f) => f.value === family)?.label} at Lv ${firstJobLevel}. Until then you're a Beginner.`
                : null
            }
          >
            {(id) => (
              <select id={id} className={inputClass} value={effectiveJob} onChange={(e) => setJobId(e.currentTarget.value as JobId)}>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-ink-2">What do you want from training right now?</p>
          <Segmented label="Focus" value={focus} options={[...FOCUS_OPTIONS]} onChange={setFocus} />
          <p className="text-sm text-ink-3">{FOCUS_HELP[focus]} You can change this any time.</p>
          <p className="text-sm text-ink-3">Stats, skills and unlocks are optional — add them later for sharper tips.</p>
        </div>
      )}

      <div className="flex justify-between">
        <div>
          {step > 1 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              ← Back
            </Button>
          ) : (
            onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )
          )}
        </div>
        {step < 3 ? (
          <Button variant="primary" disabled={step === 1 && !nameOk} onClick={() => setStep(step + 1)}>
            Next →
          </Button>
        ) : (
          <Button variant="primary" onClick={finish}>
            Start
          </Button>
        )}
      </div>
    </div>
  );
}
