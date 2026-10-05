import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import { bytesToBase64 } from "./base64";
import type { Platform } from "./types";

const bytesOrNull = (buf: ArrayBuffer): Uint8Array | null =>
  buf.byteLength === 0 ? null : new Uint8Array(buf);

export const tauriPlatform: Platform = {
  kind: "tauri",
  getPaths: () => invoke("get_paths"),
  profilesLoad: () => invoke("profiles_load"),
  profilesSave: (json) => invoke("profiles_save", { json }),
  backupsList: () => invoke("backups_list"),
  backupsRestore: (file) => invoke("backups_restore", { file }),
  backupNow: () => invoke("profiles_backup_now"),
  exportSave: (fileName, json) => invoke("export_save", { fileName, json }),
  revealFolder: (which) => invoke("reveal_folder", { which }),
  fieldNoteCreate: (json) => invoke("field_note_create", { json }),
  fieldNoteAddImage: (noteId, bytes) =>
    invoke("field_note_add_image", bytes, { headers: { "x-note-id": noteId } }),
  screenshotSave: (profileId, bytes) =>
    invoke("screenshot_save", bytes, { headers: { "x-profile-id": profileId } }),
  screenshotRead: async (profileId) =>
    bytesOrNull(await invoke<ArrayBuffer>("screenshot_read", { profileId })),
  screenshotDelete: (profileId) => invoke("screenshot_delete", { profileId }),
  entityImageSave: (kind, id, bytes) =>
    invoke("entity_image_save", bytes, { headers: { "x-kind": kind, "x-id": id } }),
  entityImageRead: async (kind, id) =>
    bytesOrNull(await invoke<ArrayBuffer>("entity_image_read", { kind, id })),
  entityImageDelete: (kind, id) => invoke("entity_image_delete", { kind, id }),
  imageCacheSave: (kind, id, bytes) => invoke("image_cache_save", bytes, { headers: { "x-kind": kind, "x-id": id } }),
  imageCacheRead: async (kind, id) => bytesOrNull(await invoke<ArrayBuffer>("image_cache_read", { kind, id })),
  openUrl: (url) => openUrl(url),
  packActive: () => invoke("pack_active"),
  packRead: (file) => invoke("pack_read", { file }),
  packVerifyManifest: (manifestJson, signature) =>
    invoke("pack_verify_manifest", { manifestJson, signature }),
  packInstall: (manifestJson, signature, files) =>
    invoke("pack_install", {
      manifestJson,
      signature,
      files: files.map(({ path, bytes }) => ({
        path,
        bytes: typeof bytes === "string" ? bytes : bytesToBase64(bytes),
      })),
    }),
  packRollback: () => invoke("pack_rollback"),
  appUpdateApply: (url, sha256, signature) =>
    invoke("app_update_apply", { url, sha256, signature }),
  appVersion: () => invoke("app_version"),
  cacheRead: (key) => invoke("cache_read", { key }),
  cacheWrite: (key, json) => invoke("cache_write", { key, json }),
  screenListWindows: () => invoke("screen_list_windows"),
  screenSnapshot: (windowId) => invoke("screen_snapshot", { windowId }),
  screenRead: (windowId, regions) => invoke("screen_read", { windowId, regions }),
  hotkeyStatus: () => invoke("hotkey_status"),
  notify: (title, body) => invoke("notify_show", { title, body }),
  notifyStatus: () => invoke("notify_status"),
  miniWindowOpen: () => invoke("mini_window_open"),
  miniWindowClose: () => invoke("mini_window_close"),
  relayToMain: (kind, payload) => invoke("relay_to_main", { kind, payload: payload ?? null }),
  onEvent: (name: string, handler: (payload: unknown) => void) => onEvent(name, handler),
};

/**
 * Listens on *this* webview window: gets events Rust sends to every window and to this window's label, but not
 * ones aimed at another window (e.g. `mcc://mini-action` → main only). The returned function works even
 * before `listen` has resolved.
 */
function onEvent(name: string, handler: (payload: unknown) => void): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  getCurrentWebviewWindow()
    .listen(name, (event) => handler(event.payload))
    .then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    })
    .catch((err: unknown) => console.error(`Can't listen for ${name}:`, err));
  return () => {
    cancelled = true;
    stop?.();
    stop = null;
  };
}
