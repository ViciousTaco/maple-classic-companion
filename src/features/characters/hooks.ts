import { useEffect, useState } from "react";
import type { Profile } from "../../data/schema/profile";
import type { Platform } from "../../platform/types";
import type { ProfileStore } from "./store";
import { usePlatform } from "../../app/context";

/** Bytes of a character's saved screenshot; reloads when it changes. */
export function useScreenshot(profile: Pick<Profile, "id" | "screenshot"> | null): Uint8Array | null {
  const platform = usePlatform();
  const id = profile?.id;
  const version = profile?.screenshot?.updatedAt;
  const key = id && version ? `${id}@${version}` : null;
  const [loaded, setLoaded] = useState<{ key: string; bytes: Uint8Array | null } | null>(null);
  useEffect(() => {
    if (!key || !id) return;
    let live = true;
    platform
      .screenshotRead(id)
      .then((bytes) => live && setLoaded({ key, bytes }))
      .catch(() => live && setLoaded({ key, bytes: null }));
    return () => {
      live = false;
    };
  }, [platform, key, id]);
  return loaded && loaded.key === key ? loaded.bytes : null;
}

export async function saveScreenshot(platform: Platform, store: ProfileStore, profileId: string, bytes: Uint8Array) {
  const { file } = await platform.screenshotSave(profileId, bytes);
  store.getState().updateProfile(profileId, (p) => ({
    ...p,
    screenshot: { file, updatedAt: new Date().toISOString() },
  }));
}

export async function removeScreenshot(platform: Platform, store: ProfileStore, profileId: string) {
  await platform.screenshotDelete(profileId);
  store.getState().updateProfile(profileId, (p) => ({ ...p, screenshot: null }));
}

export const FOCUS_OPTIONS = [
  { value: "exp", label: "EXP" },
  { value: "rare-drop", label: "Rare drops" },
  { value: "class-equip", label: "Class gear" },
  { value: "meso", label: "Meso" },
  { value: "balanced", label: "Balanced" },
] as const;

export function relativeTime(iso: string, now = new Date()): string {
  const sec = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
