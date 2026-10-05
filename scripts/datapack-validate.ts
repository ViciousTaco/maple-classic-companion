// npm run datapack:validate [dir]  — exits non-zero with a readable list if any validator rule fails (plan §8.5).
import { resolve } from "node:path";
import { formatIssue, parsePackFiles, validatePack } from "../src/data/validate";
import { readSource } from "./lib/source";

export function validateDir(dir: string): { ok: boolean; lines: string[]; packVersion?: string } {
  const { raw, problems } = readSource(dir);
  const lines = problems.map((p) => `JSON · ${p}`);
  const parsed = parsePackFiles(raw);
  lines.push(...parsed.issues.map(formatIssue));
  if (!parsed.pack) return { ok: false, lines };
  lines.push(...validatePack(parsed.pack).map(formatIssue));
  return { ok: lines.length === 0, lines, packVersion: parsed.pack.meta.packVersion };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const dir = resolve(process.argv[2] ?? "datapack");
  const r = validateDir(dir);
  if (r.ok) {
    console.log(`✓ datapack valid (${r.packVersion}) — ${dir}`);
  } else {
    console.error(`✗ datapack has ${r.lines.length} problem(s) — ${dir}`);
    for (const l of r.lines) console.error(`  ${l}`);
    process.exit(1);
  }
}
