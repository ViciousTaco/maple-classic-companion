// npm run datapack:build  — validate datapack/ → dist-datapack/*.json (minified) + manifest.json (plan §8.6).
// npm run datapack:bundle — also copies dist-datapack/ to public/baseline/ (the baseline bundled in the exe).
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PACK_FILES, type PackKey } from "../src/data/schema/pack";
import { formatIssue, parsePackFiles, validatePack } from "../src/data/validate";
import { readSource } from "./lib/source";
import pkg from "../package.json" with { type: "json" };

export const MANIFEST_SCHEMA = 1;

export function buildPack(srcDir: string, outDir: string, now = new Date()) {
  const { raw, problems } = readSource(srcDir);
  const parsed = parsePackFiles(raw);
  const issues = [...problems, ...parsed.issues.map(formatIssue), ...(parsed.pack ? validatePack(parsed.pack, { now }).map(formatIssue) : [])];
  if (!parsed.pack || issues.length) throw new Error(`datapack is invalid:\n  ${issues.join("\n  ")}`);
  const pack = parsed.pack;

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const files = (Object.keys(PACK_FILES) as PackKey[]).map((key) => {
    const body = JSON.stringify(pack[key]);
    const path = PACK_FILES[key];
    writeFileSync(join(outDir, path), body, "utf8");
    return { path, sha256: createHash("sha256").update(body, "utf8").digest("hex"), bytes: Buffer.byteLength(body, "utf8") };
  });
  const manifest = {
    schema: MANIFEST_SCHEMA,
    packVersion: pack.meta.packVersion,
    builtAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    minAppVersion: pkg.version,
    gameLabel: pack.meta.gameLabel,
    reviewedThroughArticleId: pack.meta.reviewedThroughArticleId,
    files,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  // The licence and attribution notice travels with the data (CC BY-NC-SA: attribution + share-alike).
  copyFileSync(resolve("datapack/NOTICE.md"), join(outDir, "NOTICE.md"));
  return manifest;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  try {
    const out = resolve("dist-datapack");
    const m = buildPack(resolve("datapack"), out);
    console.log(`✓ built ${m.packVersion}: ${m.files.length} files, ${m.files.reduce((a, f) => a + f.bytes, 0)} bytes → ${out}`);
    if (process.argv.includes("--bundle")) {
      const baseline = resolve("public/baseline");
      rmSync(baseline, { recursive: true, force: true });
      cpSync(out, baseline, { recursive: true });
      console.log(`✓ copied to ${baseline}`);
    }
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
