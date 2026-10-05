import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/types";
import { migrate } from "../../data/schema/migrations";
import {
  ProfileSchema,
  emptyProfilesFile,
  type Profile,
  type ProfileInput,
  type ProfilesFile,
  type Settings,
} from "../../data/schema/profile";

export type Notice =
  | { kind: "restored"; savedAt: string; corruptFile: string | null }
  | { kind: "corrupt-kept"; corruptFile: string }
  | { kind: "read-only"; version: number }
  | { kind: "invalid"; error: string };

export type RemovedProfile = { profile: Profile; index: number; wasActive: boolean };

export type ProfilesState = {
  status: "loading" | "ready" | "read-only";
  file: ProfilesFile;
  notice: Notice | null;
  saveError: string | null;

  load(): Promise<void>;
  /** Saves now if anything is pending. Call before the window closes. */
  flush(): Promise<void>;
  dismissNotice(): void;

  createProfile(input: Omit<ProfileInput, "id" | "createdAt" | "updatedAt">): Profile;
  updateProfile(id: string, change: (p: Profile) => Profile): void;
  setActive(id: string | null): void;
  duplicateProfile(id: string): Profile | null;
  removeProfile(id: string): RemovedProfile | null;
  restoreProfile(removed: RemovedProfile): void;
  addImportedProfile(profile: Profile): void;
  updateSettings(change: Partial<Settings>): void;
  /** Replaces everything (restore from backup). */
  replaceFile(file: ProfilesFile): void;
};

export type ProfileStore = StoreApi<ProfilesState>;

type Options = { debounceMs?: number; now?: () => Date; newId?: () => string };

export function createProfileStore(platform: Platform, opts: Options = {}): ProfileStore {
  const debounceMs = opts.debounceMs ?? 400;
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? (() => crypto.randomUUID());

  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let saving: Promise<void> = Promise.resolve();

  return createStore<ProfilesState>()((set, get) => {
    const writeNow = async () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!dirty || get().status !== "ready") return;
      dirty = false;
      const json = JSON.stringify(get().file, null, 2);
      try {
        await platform.profilesSave(json);
        if (get().saveError) set({ saveError: null });
      } catch (err) {
        dirty = true; // retry on the next change or flush
        set({ saveError: String(err) });
      }
    };

    const schedule = () => {
      dirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        saving = saving.then(writeNow);
      }, debounceMs);
    };

    /** Applies a change to the file and schedules a save. Ignored while read-only. */
    const mutate = (change: (f: ProfilesFile) => ProfilesFile) => {
      if (get().status !== "ready") return;
      set({ file: change(get().file) });
      schedule();
    };

    const stamp = () => now().toISOString();

    return {
      status: "loading",
      file: emptyProfilesFile(),
      notice: null,
      saveError: null,

      async load() {
        const res = await platform.profilesLoad();
        let notice: Notice | null = null;
        if (res.restoredFromBackup) {
          notice = { kind: "restored", savedAt: res.restoredFromBackup, corruptFile: res.corruptFile };
        } else if (res.corruptFile) {
          notice = { kind: "corrupt-kept", corruptFile: res.corruptFile };
        }
        if (res.json === null) {
          set({ status: "ready", file: emptyProfilesFile(), notice });
          return;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(res.json);
        } catch {
          raw = null;
        }
        const m = migrate(raw);
        if (m.kind === "ok") {
          set({ status: "ready", file: m.file, notice });
        } else if (m.kind === "read-only") {
          set({
            status: "read-only",
            file: m.file ?? emptyProfilesFile(),
            notice: { kind: "read-only", version: m.version },
          });
        } else {
          // Never overwrite a file we can't understand: stay read-only until a backup is restored.
          set({ status: "read-only", file: emptyProfilesFile(), notice: { kind: "invalid", error: m.error } });
        }
      },

      flush() {
        saving = saving.then(writeNow);
        return saving;
      },

      dismissNotice: () => set({ notice: null }),

      createProfile(input) {
        const t = stamp();
        const profile = ProfileSchema.parse({ ...input, id: newId(), createdAt: t, updatedAt: t });
        mutate((f) => ({ ...f, profiles: [...f.profiles, profile], activeProfileId: profile.id }));
        return profile;
      },

      updateProfile(id, change) {
        mutate((f) => ({
          ...f,
          profiles: f.profiles.map((p) => (p.id === id ? { ...change(p), id, updatedAt: stamp() } : p)),
        }));
      },

      setActive(id) {
        if (get().file.activeProfileId === id) return;
        mutate((f) => ({ ...f, activeProfileId: id }));
      },

      duplicateProfile(id) {
        const src = get().file.profiles.find((p) => p.id === id);
        if (!src || get().status !== "ready") return null;
        const t = stamp();
        const copy: Profile = {
          ...structuredClone(src),
          id: newId(),
          name: `${src.name} copy`.slice(0, 24),
          createdAt: t,
          updatedAt: t,
          screenshot: null,
          archived: false,
        };
        mutate((f) => ({ ...f, profiles: [...f.profiles, copy] }));
        return copy;
      },

      removeProfile(id) {
        const f = get().file;
        const index = f.profiles.findIndex((p) => p.id === id);
        const profile = f.profiles[index];
        if (!profile || get().status !== "ready") return null;
        const wasActive = f.activeProfileId === id;
        mutate((file) => {
          const profiles = file.profiles.filter((p) => p.id !== id);
          const nextActive = wasActive
            ? (profiles.find((p) => !p.archived)?.id ?? profiles[0]?.id ?? null)
            : file.activeProfileId;
          return { ...file, profiles, activeProfileId: nextActive };
        });
        return { profile, index, wasActive };
      },

      restoreProfile({ profile, index, wasActive }) {
        mutate((f) => {
          if (f.profiles.some((p) => p.id === profile.id)) return f;
          const profiles = [...f.profiles];
          profiles.splice(Math.min(index, profiles.length), 0, profile);
          return { ...f, profiles, activeProfileId: wasActive ? profile.id : f.activeProfileId };
        });
      },

      addImportedProfile(profile) {
        mutate((f) => ({ ...f, profiles: [...f.profiles, profile] }));
      },

      updateSettings(change) {
        mutate((f) => ({ ...f, settings: { ...f.settings, ...change } }));
      },

      replaceFile(file) {
        set({ status: "ready", notice: null });
        mutate(() => file);
      },
    };
  });
}

export function activeProfile(s: Pick<ProfilesState, "file">): Profile | null {
  return s.file.profiles.find((p) => p.id === s.file.activeProfileId) ?? null;
}
