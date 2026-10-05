/** Typed contract for the Rust commands in plan §8.3. */
export type AppPaths = { dataDir: string; portable: boolean };
export type ProfilesLoadResult = {
  json: string | null;
  restoredFromBackup: string | null;
  corruptFile: string | null;
};
export type BackupInfo = { file: string; savedAt: string };
export type EntityKind = "monster" | "map" | "item" | "npc";
export type FolderName = "data" | "backups" | "exports" | "field-notes";
/** `null`s → no installed pack is active; the UI uses the bundled baseline. */
export type PackActive = { version: string | null; dir: string | null };
/**
 * One changed pack file for `packInstall`. `bytes` crosses IPC as base64 (one JSON payload can't carry
 * several raw binary bodies): pass a `Uint8Array` and the wrapper encodes it, or an already-base64 string.
 */
export type PackFileUpload = { path: string; bytes: Uint8Array | string };
/** `pack_install` fails with a message starting with this when it needs every file resent (§8.6 step 7). */
export const NEED_ALL_FILES = "NEED_ALL_FILES";
/** The only URLs `app_update_apply` accepts start with this. */
export const RELEASE_URL_PREFIX =
  "https://github.com/ViciousTaco/maple-classic-companion/releases/download/";

export interface Platform {
  readonly kind: "tauri" | "mock";
  getPaths(): Promise<AppPaths>;
  profilesLoad(): Promise<ProfilesLoadResult>;
  profilesSave(json: string): Promise<void>;
  backupsList(): Promise<BackupInfo[]>;
  backupsRestore(file: string): Promise<string>;
  /** Copies the current save into backups (before a restore replaces it). */
  backupNow(): Promise<void>;
  /** Writes `<data>/exports/<fileName>`; returns the full path. */
  exportSave(fileName: string, json: string): Promise<string>;
  /** Opens a data sub-folder in Explorer. */
  revealFolder(which: FolderName): Promise<void>;
  /** Creates a Quick note folder with note.json; returns its id. */
  fieldNoteCreate(json: string): Promise<string>;
  fieldNoteAddImage(noteId: string, bytes: Uint8Array): Promise<{ file: string }>;
  screenshotSave(profileId: string, bytes: Uint8Array): Promise<{ file: string }>;
  /** `null` when the character has no screenshot. */
  screenshotRead(profileId: string): Promise<Uint8Array | null>;
  screenshotDelete(profileId: string): Promise<void>;
  entityImageSave(kind: EntityKind, id: string, bytes: Uint8Array): Promise<{ file: string }>;
  entityImageRead(kind: EntityKind, id: string): Promise<Uint8Array | null>;
  entityImageDelete(kind: EntityKind, id: string): Promise<void>;
  /** Downloaded reference images (approved wiki), stored apart from the player's own pictures. */
  imageCacheSave(kind: EntityKind, id: string, bytes: Uint8Array): Promise<{ file: string }>;
  imageCacheRead(kind: EntityKind, id: string): Promise<Uint8Array | null>;
  /** Opens a URL in the default browser (allow-listed in Rust capabilities). */
  openUrl(url: string): Promise<void>;

  // ---- Live updates (P8, §8.3 / §8.6) ----
  /** The active installed datapack. Heals by itself if `current.txt` names a pack that is gone. */
  packActive(): Promise<PackActive>;
  /** Reads a file (`^[a-z0-9.-]+\.json$`, incl. `manifest.json`) from the active installed pack. */
  packRead(file: string): Promise<string>;
  /** Minisign check of the exact manifest text against the compiled-in key, plus manifest shape rules. */
  packVerifyManifest(
    manifestJson: string,
    signature: string,
  ): Promise<{ ok: boolean; error?: string | null }>;
  /**
   * §8.6 steps 7–9 with the **changed** files only; unchanged ones are copied from the active installed pack.
   * Rejects with a message starting with `NEED_ALL_FILES` when that isn't possible — resend every file.
   */
  packInstall(
    manifestJson: string,
    signature: string,
    files: PackFileUpload[],
  ): Promise<{ version: string }>;
  /** §8.6 step 10: drops the active pack and activates the previous installed one (or the bundled baseline). */
  packRollback(): Promise<PackActive>;
  /** Downloads, verifies and swaps in a new exe, then relaunches. Resolves only on failure paths in practice. */
  appUpdateApply(url: string, sha256: string, signature: string): Promise<void>;
  appVersion(): Promise<string>;
  /** JSON cached at `<data>/cache/<key>.json`; `null` when missing or unreadable. Key: `^[a-z0-9-]{1,64}$`. */
  cacheRead(key: string): Promise<string | null>;
  /** Validates the JSON and replaces the entry atomically. */
  cacheWrite(key: string, json: string): Promise<void>;
}
