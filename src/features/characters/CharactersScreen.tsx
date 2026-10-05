import { useMemo, useRef, useState } from "react";
import type { Profile } from "../../data/schema/profile";
import { jobName } from "../../data/gameRules";
import { navigate, usePlatform, useProfileStore, useProfiles, useRules } from "../../app/context";
import { motion } from "motion/react";
import { Archive, ArchiveRestore, Copy, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Button, Chip, LargeTitle, spring } from "../../ui/kit";
import { ConfirmDialog, Dialog, toast } from "../../ui/overlays";
import { Wizard } from "./Wizard";
import { FOCUS_OPTIONS, relativeTime, saveScreenshot, useScreenshot } from "./hooks";
import { parseImport } from "./transfer";
import { bytesToDataUrl } from "../../lib/image";

export function Portrait({ profile, className = "" }: { profile: Profile; className?: string }) {
  const bytes = useScreenshot(profile);
  const url = useMemo(() => (bytes ? bytesToDataUrl(bytes) : null), [bytes]);
  return url ? (
    <img src={url} alt="" className={`object-cover ${className}`} />
  ) : (
    <div className={`flex items-center justify-center bg-fill text-3xl text-ink-3 ${className}`} aria-hidden>
      {profile.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function CharacterCard({ profile, active, onDelete }: { profile: Profile; active: boolean; onDelete: (p: Profile) => void }) {
  const rules = useRules();
  const store = useProfileStore();
  const focus = FOCUS_OPTIONS.find((f) => f.value === profile.focus)?.label;
  return (
    <motion.article
      layout
      aria-label={profile.name}
      whileHover={{ y: -3 }}
      transition={spring}
      className={`glass flex gap-4 overflow-hidden rounded-[28px] p-3 ${active ? "ring-[2.5px] ring-maple/70" : ""}`}
    >
      <Portrait profile={profile} className="h-36 w-28 shrink-0 rounded-[20px] font-display" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-1 pr-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-display text-[22px] font-bold tracking-[-0.02em]">{profile.name}</h3>
          {active && <Chip tone="maple">Playing</Chip>}
          {profile.archived && <Chip>Archived</Chip>}
        </div>
        <p className="text-[15px] text-ink-2">
          Lv {profile.level} {jobName(rules, profile.jobId)} · {focus}
        </p>
        <p className="text-xs text-ink-3">Updated {relativeTime(profile.updatedAt)}</p>
        <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
          {!active && !profile.archived && (
            <Button size="sm" variant="primary" onClick={() => store.getState().setActive(profile.id)}>
              Switch to
            </Button>
          )}
          <Button size="sm" onClick={() => navigate(`/characters/${profile.id}`)}>
            <Pencil size={14} /> Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Duplicate"
            title="Duplicate"
            onClick={() => {
              const copy = store.getState().duplicateProfile(profile.id);
              if (copy) toast({ message: `Created ${copy.name}` });
            }}
          >
            <Copy size={15} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={profile.archived ? "Unarchive" : "Archive"}
            title={profile.archived ? "Unarchive" : "Archive"}
            onClick={() => {
              store.getState().updateProfile(profile.id, (p) => ({ ...p, archived: !p.archived }));
              if (active && !profile.archived) store.getState().setActive(null);
            }}
          >
            {profile.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </Button>
          <Button size="sm" variant="ghost" aria-label="Delete" title="Delete" className="!text-danger" onClick={() => onDelete(profile)}>
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
    </motion.article>
  );
}

export function CharactersScreen() {
  const rules = useRules();
  const store = useProfileStore();
  const platform = usePlatform();
  const profiles = useProfiles((s) => s.file.profiles);
  const activeId = useProfiles((s) => s.file.activeProfileId);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const current = profiles.filter((p) => !p.archived);
  const archived = profiles.filter((p) => p.archived);

  const confirmDelete = () => {
    if (!deleting) return;
    const removed = store.getState().removeProfile(deleting.id);
    setDeleting(null);
    if (!removed) return;
    let undone = false;
    toast({
      message: `Deleted ${removed.profile.name}`,
      durationMs: 10_000,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          store.getState().restoreProfile(removed);
        },
      },
      // Only once the undo window has passed is the screenshot file removed.
      onExpire: () => {
        if (!undone && removed.profile.screenshot) void platform.screenshotDelete(removed.profile.id).catch(() => {});
      },
    });
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    const r = parseImport(await file.text(), crypto.randomUUID(), new Date());
    if (!r.ok) {
      toast({ message: r.error, tone: "error", durationMs: 8000 });
      return;
    }
    store.getState().addImportedProfile(r.profile);
    if (r.screenshot) {
      try {
        await saveScreenshot(platform, store, r.profile.id, r.screenshot);
      } catch {
        toast({ message: "Imported, but the picture in the file couldn't be used.", tone: "error" });
      }
    }
    toast({ message: `Imported ${r.profile.name}` });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <LargeTitle sub={`Save as many as you like — the game allows ${rules.charactersPerAccount} per account.`}>Characters</LargeTitle>
        <div className="flex gap-2">
          <Button onClick={() => importInput.current?.click()}>
            <Upload size={16} /> Import
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={18} strokeWidth={2.6} /> New character
          </Button>
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="Import character file"
            onChange={(e) => {
              void doImport(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {current.map((p) => (
          <CharacterCard key={p.id} profile={p} active={p.id === activeId} onDelete={setDeleting} />
        ))}
      </div>

      {archived.length > 0 && (
        <details className="glass rounded-[24px] p-4">
          <summary className="cursor-pointer font-medium">Archived ({archived.length})</summary>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {archived.map((p) => (
              <CharacterCard key={p.id} profile={p} active={false} onDelete={setDeleting} />
            ))}
          </div>
        </details>
      )}

      <Dialog open={creating} onOpenChange={setCreating} title="New character" wide>
        <Wizard
          onCancel={() => setCreating(false)}
          onDone={(p) => {
            setCreating(false);
            toast({ message: `${p.name} is ready` });
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        body="You can undo this for 10 seconds. Older copies also stay in your backups."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
      />
    </div>
  );
}
