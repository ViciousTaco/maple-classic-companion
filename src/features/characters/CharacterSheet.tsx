import type { JobId, Profile } from "../../data/schema/profile";
import { jobById, jobLine, jobName, jobsForLevel, requiredLevel, type GameRules } from "../../data/gameRules";
import { navigate, usePack, usePlatform, useProfileStore, useProfiles, useRules } from "../../app/context";
import { StatAdvice } from "../stats/StatAdvice";
import { Button, Card, Field, LargeTitle, NumberInput, Section, Sections, Segmented, Stepper, Toggle, inputClass } from "../../ui/kit";
import { toast } from "../../ui/overlays";
import { ScreenshotPicker } from "./ScreenshotPicker";
import { SkillsEditor, skillsForJob, type SkillDef } from "./SkillsEditor";
import { FOCUS_OPTIONS, removeScreenshot, saveScreenshot, useScreenshot } from "./hooks";
import { buildExport, exportFileName } from "./transfer";

/** Job options for a level: the character's own line first, then everything else valid at that level. */
export function jobOptions(rules: GameRules, level: number, current: JobId) {
  const valid = jobsForLevel(rules, level);
  const line = jobLine(rules, current);
  return {
    mine: valid.filter((j) => line.has(j.id)),
    others: valid.filter((j) => !line.has(j.id)),
  };
}

export function JobPicker({ id, level, value, onChange }: { id: string; level: number; value: JobId; onChange: (j: JobId) => void }) {
  const rules = useRules();
  const { mine, others } = jobOptions(rules, level, value);
  const currentMissing = !mine.some((j) => j.id === value);
  return (
    <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.currentTarget.value as JobId)}>
      {currentMissing && <option value={value}>{jobName(rules, value)} (needs a higher level)</option>}
      <optgroup label="Your class line">
        {mine.map((j) => (
          <option key={j.id} value={j.id}>
            {j.name}
          </option>
        ))}
      </optgroup>
      {others.length > 0 && (
        <optgroup label="Other classes">
          {others.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function toggle(list: string[], id: string, on: boolean): string[] {
  return on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <Toggle label={label} checked={checked} onChange={onChange} />;
}

/** iOS grouped list: a caption above rows separated by hairlines. */
const GROUP = "rounded-[20px] bg-fill px-4 [&>label+label]:border-t [&>label+label]:border-hairline";
const LEGEND = "float-left w-full pb-1.5 pl-1 pt-0 text-[13px] font-semibold text-ink-2";

const STAT_FIELDS = [
  ["str", "STR", 9999],
  ["dex", "DEX", 9999],
  ["int", "INT", 9999],
  ["luk", "LUK", 9999],
  ["hp", "Max HP", 99999],
  ["mp", "Max MP", 99999],
] as const;

export function CharacterSheet({ profileId }: { profileId: string }) {
  const rules = useRules();
  const store = useProfileStore();
  const platform = usePlatform();
  const profile = useProfiles((s) => s.file.profiles.find((p) => p.id === profileId) ?? null);
  const shot = useScreenshot(profile);
  const pack = usePack();

  if (!profile) {
    return (
      <Card>
        <p>That character no longer exists.</p>
        <Button className="mt-3" onClick={() => navigate("/characters")}>
          Back to characters
        </Button>
      </Card>
    );
  }

  const update = (change: (p: Profile) => Profile) => store.getState().updateProfile(profile.id, change);
  const job = jobById(rules, profile.jobId);
  const need = requiredLevel(rules, profile.jobId);
  const { damageMin, damageMax } = profile.combat;
  const attackSkills = skillsForJob(rules, (pack?.skills ?? []) as SkillDef[], profile.jobId).filter((s) => pack?.index.skillById.get(s.id)?.kind === "attack");
  const filledStats = STAT_FIELDS.filter(([k]) => profile.stats[k] !== undefined).length;
  const unlockCount =
    profile.unlocks.areas.length +
    profile.unlocks.bossesDefeated.length +
    profile.unlocks.partyQuests.length +
    (profile.unlocks.citizenship ? 1 : 0) +
    Object.keys(profile.unlocks.crafting).length;

  const doExport = async () => {
    try {
      const json = buildExport(profile, shot, new Date());
      const path = await platform.exportSave(exportFileName(profile, job?.name ?? profile.jobId), json);
      toast({ message: `Exported to ${path}`, action: { label: "Open folder", onClick: () => void platform.revealFolder("exports") } });
    } catch (err) {
      toast({ message: `Export failed: ${String(err)}`, tone: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/characters")}>
          ← All characters
        </Button>
        <span className="text-sm text-ink-3">Changes save automatically</span>
      </div>
      <LargeTitle sub={`Lv ${profile.level} ${job?.name ?? ""}`}>{profile.name}</LargeTitle>

      <Sections defaultOpen={["identity"]}>
        <Section value="identity" title="Identity" summary={`${profile.name} · Lv ${profile.level} ${job?.name ?? ""}`}>
          <div className="grid gap-6 md:grid-cols-[12rem_1fr]">
            <ScreenshotPicker
              bytes={shot}
              onBytes={async (b) => {
                try {
                  await saveScreenshot(platform, store, profile.id, b);
                } catch (err) {
                  toast({ message: `Couldn't save the picture: ${String(err)}`, tone: "error" });
                }
              }}
              onRemove={() => void removeScreenshot(platform, store, profile.id)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" warning={profile.name.trim() ? null : "A name helps you tell characters apart."}>
                {(id) => (
                  <input
                    id={id}
                    className={inputClass}
                    maxLength={24}
                    defaultValue={profile.name}
                    onChange={(e) => {
                      const name = e.currentTarget.value.trim();
                      if (name) update((p) => ({ ...p, name }));
                    }}
                  />
                )}
              </Field>
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink-2">Level</p>
                <Stepper label="Level" value={profile.level} min={1} max={Math.max(rules.levelCap, profile.level)} onChange={(level) => update((p) => ({ ...p, level }))} />
              </div>
              <Field
                label="Job"
                warning={need > profile.level ? `${job?.name ?? profile.jobId} is available from Lv ${need} — check your level or job.` : null}
              >
                {(id) => <JobPicker id={id} level={profile.level} value={profile.jobId} onChange={(jobId) => update((p) => ({ ...p, jobId }))} />}
              </Field>
              <Field label="EXP %" hint="Optional — from the bar at the bottom of the game screen.">
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    className={inputClass}
                    value={profile.expPercent ?? ""}
                    onChange={(e) => {
                      const raw = e.currentTarget.value;
                      const n = Number(raw);
                      update((p) => ({ ...p, expPercent: raw === "" || !Number.isFinite(n) ? null : Math.min(100, Math.max(0, n)) }));
                    }}
                  />
                )}
              </Field>
              <div className="space-y-1 sm:col-span-2">
                <p className="text-sm font-medium text-ink-2">Training focus</p>
                <Segmented label="Training focus" value={profile.focus} options={[...FOCUS_OPTIONS]} onChange={(focus) => update((p) => ({ ...p, focus }))} />
              </div>
            </div>
          </div>
        </Section>

        <Section value="stats" title="Stats" summary={filledStats ? `${filledStats} of 6 filled` : "optional — and where to put your points"}>
          <div className="mb-5">
            <StatAdvice pack={pack} profile={profile} />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {STAT_FIELDS.map(([key, label, max]) => (
              <Field key={key} label={label}>
                {(id) => (
                  <NumberInput
                    id={id}
                    value={profile.stats[key]}
                    max={max}
                    onChange={(v) =>
                      update((p) => {
                        const stats = { ...p.stats };
                        if (v === undefined) delete stats[key];
                        else stats[key] = v;
                        return { ...p, stats };
                      })
                    }
                  />
                )}
              </Field>
            ))}
          </div>
        </Section>

        <Section
          value="combat"
          title="Combat"
          summary={damageMin && damageMax ? `damage ${damageMin}–${damageMax}` : "add your damage range for EXP/hour estimates"}
        >
          <div className="grid grid-cols-2 gap-4">
            {(
              [
                ["damageMin", "Damage (low)", 999999],
                ["damageMax", "Damage (high)", 999999],
                ["accuracy", "Accuracy", 9999],
                ["avoid", "Avoidability", 9999],
              ] as const
            ).map(([key, label, max]) => (
              <Field
                key={key}
                label={label}
                hint={key === "damageMin" ? "As shown in your in-game stat window." : undefined}
                warning={key === "damageMax" && damageMin !== undefined && damageMax !== undefined && damageMin > damageMax ? "High is lower than low — check the numbers." : null}
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={profile.combat[key]}
                    max={max}
                    onChange={(v) =>
                      update((p) => {
                        const combat = { ...p.combat };
                        if (v === undefined) delete combat[key];
                        else combat[key] = v;
                        return { ...p, combat };
                      })
                    }
                  />
                )}
              </Field>
            ))}
            <Field label="Weapon type" hint="e.g. Dagger, Claw, Staff">
              {(id) => (
                <input
                  id={id}
                  className={inputClass}
                  maxLength={32}
                  value={profile.combat.weaponType ?? ""}
                  onChange={(e) => {
                    const weaponType = e.currentTarget.value;
                    update((p) => {
                      const combat = { ...p.combat };
                      if (weaponType) combat.weaponType = weaponType;
                      else delete combat.weaponType;
                      return { ...p, combat };
                    });
                  }}
                />
              )}
            </Field>
            {attackSkills.length > 0 && (
              <Field label="Main attack skill" hint="Its damage %, hits and targets (at the level set under Skills) go into the EXP/hour estimate.">
                {(id) => (
                  <select
                    id={id}
                    className={inputClass}
                    value={profile.combat.mainSkillId ?? ""}
                    onChange={(e) => {
                      const mainSkillId = e.currentTarget.value;
                      update((p) => {
                        const combat = { ...p.combat };
                        if (mainSkillId) combat.mainSkillId = mainSkillId;
                        else delete combat.mainSkillId;
                        return { ...p, combat };
                      });
                    }}
                  >
                    <option value="">Regular attack</option>
                    {attackSkills.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {(profile.skills[s.id] ?? 0) > 0 ? ` (level ${profile.skills[s.id]})` : " (not learned yet)"}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </div>
        </Section>

        <Section value="skills" title="Skills" summary={`${Object.keys(profile.skills).length} set`}>
          <SkillsEditor rules={rules} skills={(pack?.skills ?? []) as SkillDef[]} jobId={profile.jobId} values={profile.skills} onChange={(skills) => update((p) => ({ ...p, skills }))} />
        </Section>

        <Section value="unlocks" title="Unlocks" summary={unlockCount ? `${unlockCount} recorded` : "what this character has done"}>
          <div className="grid gap-6 sm:grid-cols-2">
            <fieldset className="min-w-0">
              <legend className={LEGEND}>Areas reached</legend>
              <div className={`clear-both ${GROUP}`}>
              {rules.regions.map((r) => (
                <Check
                  key={r.id}
                  label={r.name}
                  checked={profile.unlocks.areas.includes(r.id)}
                  onChange={(on) => update((p) => ({ ...p, unlocks: { ...p.unlocks, areas: toggle(p.unlocks.areas, r.id, on) } }))}
                />
              ))}
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className={LEGEND}>Bosses defeated</legend>
              <div className={`clear-both ${GROUP}`}>
              {rules.bosses.map((b) => (
                <Check
                  key={b.id}
                  label={b.name}
                  checked={profile.unlocks.bossesDefeated.includes(b.id)}
                  onChange={(on) =>
                    update((p) => ({ ...p, unlocks: { ...p.unlocks, bossesDefeated: toggle(p.unlocks.bossesDefeated, b.id, on) } }))
                  }
                />
              ))}
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className={LEGEND}>Party quests done</legend>
              <div className={`clear-both ${GROUP}`}>
              {rules.partyQuests.map((q) => (
                <Check
                  key={q.id}
                  label={`${q.name} (Lv ${q.minLevel}+, ${q.town})`}
                  checked={profile.unlocks.partyQuests.includes(q.id)}
                  onChange={(on) =>
                    update((p) => ({ ...p, unlocks: { ...p.unlocks, partyQuests: toggle(p.unlocks.partyQuests, q.id, on) } }))
                  }
                />
              ))}
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className={LEGEND}>Citizenship (Lv {rules.citizenship.minLevel}+)</legend>
              <div className="clear-both flex gap-2">
                <select
                  aria-label="Citizenship town"
                  className={inputClass}
                  value={profile.unlocks.citizenship?.town ?? ""}
                  onChange={(e) => {
                    const town = e.currentTarget.value as "henesys" | "kerning" | "";
                    update((p) => ({
                      ...p,
                      unlocks: { ...p.unlocks, citizenship: town ? { town, grade: p.unlocks.citizenship?.grade ?? 0 } : null },
                    }));
                  }}
                >
                  <option value="">None</option>
                  {rules.citizenship.towns.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.npc}, {t.place})
                    </option>
                  ))}
                </select>
                {profile.unlocks.citizenship && (
                  <div className="w-28">
                    <NumberInput
                      id="citizenship-grade"
                      placeholder="Grade"
                      value={profile.unlocks.citizenship.grade}
                      max={99}
                      onChange={(v) =>
                        update((p) => ({
                          ...p,
                          unlocks: { ...p.unlocks, citizenship: p.unlocks.citizenship && { ...p.unlocks.citizenship, grade: v ?? 0 } },
                        }))
                      }
                    />
                  </div>
                )}
              </div>
            </fieldset>
            <fieldset className="min-w-0 sm:col-span-2">
              <legend className={LEGEND}>Crafting levels</legend>
              <div className="clear-both grid grid-cols-2 gap-3 sm:grid-cols-3">
                {rules.crafting.map((c) => (
                  <Field key={c.id} label={c.name} hint={c.npc}>
                    {(id) => (
                      <NumberInput
                        id={id}
                        value={profile.unlocks.crafting[c.id]}
                        max={999}
                        onChange={(v) =>
                          update((p) => {
                            const crafting = { ...p.unlocks.crafting };
                            if (v === undefined || v === 0) delete crafting[c.id];
                            else crafting[c.id] = v;
                            return { ...p, unlocks: { ...p.unlocks, crafting } };
                          })
                        }
                      />
                    )}
                  </Field>
                ))}
              </div>
            </fieldset>
            <p className="text-sm text-ink-3 sm:col-span-2">Quests you've finished are ticked off from the Quests screen once quest data is added.</p>
          </div>
        </Section>

        <Section value="notes" title="Notes" summary={profile.notes ? `${profile.notes.length} characters` : "anything you want to remember"}>
          <textarea
            aria-label="Notes"
            className={`${inputClass} min-h-28`}
            maxLength={4000}
            defaultValue={profile.notes}
            onChange={(e) => {
              const notes = e.currentTarget.value;
              update((p) => ({ ...p, notes }));
            }}
          />
        </Section>

        <Section value="export" title="Export" summary="copy this character to a file">
          <p className="mb-3 text-sm text-ink-2">Saves a .json file (including the screenshot) into the exports folder beside the app. Import it from the Characters screen.</p>
          <div className="flex gap-2">
            <Button onClick={doExport}>Export character</Button>
            <Button variant="ghost" onClick={() => void platform.revealFolder("exports")}>
              Open exports folder
            </Button>
          </div>
        </Section>
      </Sections>
    </div>
  );
}
