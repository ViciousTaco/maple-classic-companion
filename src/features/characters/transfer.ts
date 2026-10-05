import { z } from "zod";
import { ProfileSchema, type Profile } from "../../data/schema/profile";
import { formatZodIssues } from "../../data/schema/migrations";
import { base64ToBytes, bytesToBase64 } from "../../lib/image";

// Single-character export/import (P2-T8). The screenshot travels inside the file as base64.

const ExportSchema = z.object({
  format: z.literal("mcc-character"),
  version: z.literal(1),
  exportedAt: z.string(),
  profile: z.unknown(),
  screenshotBase64: z.string().max(600_000).nullable().optional(),
});

export function buildExport(profile: Profile, screenshot: Uint8Array | null, now: Date): string {
  return JSON.stringify(
    {
      format: "mcc-character",
      version: 1,
      exportedAt: now.toISOString(),
      profile,
      screenshotBase64: screenshot ? bytesToBase64(screenshot) : null,
    },
    null,
    2,
  );
}

/** Windows-safe file name, e.g. "Taco Lv23 Bandit.json". */
export function exportFileName(profile: Profile, jobName: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9 _-]+/g, "").replace(/\s+/g, " ").trim();
  const base = clean(`${profile.name} Lv${profile.level} ${jobName}`).slice(0, 70) || "character";
  return `${base}.json`;
}

export type ImportResult =
  | { ok: true; profile: Profile; screenshot: Uint8Array | null }
  | { ok: false; error: string };

/** Validates an export file. Always assigns a new id so an import never overwrites an existing character. */
export function parseImport(text: string, newId: string, now: Date): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't a character export (it isn't valid JSON)." };
  }
  const outer = ExportSchema.safeParse(raw);
  if (!outer.success) {
    return { ok: false, error: "That file isn't a Maple Classic Companion character export." };
  }
  const t = now.toISOString();
  const inner = ProfileSchema.safeParse({
    ...(outer.data.profile as object),
    id: newId,
    updatedAt: t,
    screenshot: null,
    archived: false,
  });
  if (!inner.success) {
    return { ok: false, error: `The character in that file has problems: ${formatZodIssues(inner.error.issues)}` };
  }
  let screenshot: Uint8Array | null = null;
  if (outer.data.screenshotBase64) {
    try {
      screenshot = base64ToBytes(outer.data.screenshotBase64);
    } catch {
      screenshot = null; // keep the character even if the picture is damaged
    }
  }
  return { ok: true, profile: inner.data, screenshot };
}
