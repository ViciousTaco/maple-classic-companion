import { PROFILES_SCHEMA_VERSION, ProfilesFileSchema, type ProfilesFile } from "./profile";

export type MigrateResult =
  | { kind: "ok"; file: ProfilesFile }
  /** Written by a newer app. Shown read-only, never down-converted or overwritten (§8.4). */
  | { kind: "read-only"; version: number; file: ProfilesFile | null }
  | { kind: "invalid"; error: string };

type Step = (raw: Record<string, unknown>) => Record<string, unknown>;

/** `STEPS[n]` upgrades a version-n file to n+1. Empty while only v1 exists. */
const STEPS: Record<number, Step> = {};

export function formatZodIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ");
}

export function migrate(raw: unknown): MigrateResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { kind: "invalid", error: "Saved data is not an object" };
  }
  let data = raw as Record<string, unknown>;
  const version = data.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { kind: "invalid", error: "Saved data has no valid schemaVersion" };
  }
  if (version > PROFILES_SCHEMA_VERSION) {
    // Best effort so the user can still see their characters.
    const lenient = ProfilesFileSchema.safeParse({ ...data, schemaVersion: PROFILES_SCHEMA_VERSION });
    return { kind: "read-only", version, file: lenient.success ? lenient.data : null };
  }
  for (let v = version; v < PROFILES_SCHEMA_VERSION; v++) {
    const step = STEPS[v];
    if (!step) return { kind: "invalid", error: `No migration from schema version ${v}` };
    data = step(data);
  }
  const parsed = ProfilesFileSchema.safeParse(data);
  return parsed.success
    ? { kind: "ok", file: parsed.data }
    : { kind: "invalid", error: formatZodIssues(parsed.error.issues) };
}
