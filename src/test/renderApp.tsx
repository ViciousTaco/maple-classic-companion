import { render, screen } from "@testing-library/react";
import App from "../App";
import { createMockPlatform } from "../platform/ipc.mock";
import { createProfileStore } from "../features/characters/store";
import { ProfilesFileSchema, type ProfileInput } from "../data/schema/profile";
import { sourcePack } from "../data/fixtures/sourcePack";

const testPack = sourcePack();
const packLoader = async () => ({ ok: true as const, pack: testPack, from: "bundled" as const, fellBack: null });

export const ID_A = "0b9f8a52-6a4e-4a39-9c55-2f1d1f7f0a11";
export const ID_B = "1c9f8a52-6a4e-4a39-9c55-2f1d1f7f0a22";

export function profileInput(over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    id: ID_A,
    name: "Taco",
    createdAt: "2026-10-05T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    jobId: "thief",
    level: 23,
    lastView: "/characters",
    ...over,
  };
}

/** Renders the whole app on the in-memory platform. `profiles` seeds the save file. */
export async function renderApp(profiles: ProfileInput[] = [], activeId: string | null = profiles[0]?.id ?? null) {
  window.location.hash = "";
  const initial =
    profiles.length === 0
      ? null
      : JSON.stringify(ProfilesFileSchema.parse({ schemaVersion: 1, activeProfileId: activeId, profiles, settings: {} }));
  const platform = createMockPlatform(initial);
  const store = createProfileStore(platform, { debounceMs: 0 });
  const utils = render(<App platform={platform} store={store} packLoader={packLoader} liveUpdates={false} />);
  // Wait for the load to finish (the loading skeleton disappears).
  await screen.findByRole(profiles.length ? "navigation" : "radiogroup", {}, { timeout: 3000 });
  return { ...utils, platform, store };
}
