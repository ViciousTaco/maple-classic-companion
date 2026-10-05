// npm run datapack:refresh [-- --limit N]
// Re-checks the MapleClassic Wiki pages our datapack cites (one page every 3 s, identified User-Agent) and reports
// which changed since the cached copy in .tmp/wiki-cache/. It never edits the datapack: a maintainer (or an AI
// session) reviews the changed pages and updates the records (MASTER_PLAN Appendix C). Fully unattended syncing
// waits for the wiki maintainers' OK (docs/wiki-permission-request.md).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parsePackFiles } from "../src/data/validate";
import { readSource } from "./lib/source";
import pkg from "../package.json" with { type: "json" };

const CACHE = resolve(".tmp/wiki-cache");
const UA = `MapleClassicCompanion/${pkg.version} (personal non-commercial fan tool; github.com/ViciousTaco/maple-classic-companion)`;

/** Only the article body matters (ignores view counters, footers and timestamps in the page chrome). */
export function articleFingerprint(html: string): string {
  const m = /<div id="mw-content-text"[\s\S]*?<div class="printfooter"/.exec(html);
  return createHash("sha256").update(m ? m[0] : html).digest("hex");
}

export function citedWikiPages(raw: unknown): string[] {
  const urls = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.url === "string" && o.url.startsWith("https://mapleclassic.wiki/wiki/")) urls.add(o.url.split("#")[0]!);
      Object.values(o).forEach(walk);
    }
  };
  walk(raw);
  return [...urls].sort();
}

const cacheFile = (url: string) => join(CACHE, `${decodeURIComponent(url.slice("https://mapleclassic.wiki/wiki/".length)).replace(/[^A-Za-z0-9_.-]/g, "_")}.html`);

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  const { raw } = readSource(resolve("datapack"));
  if (!parsePackFiles(raw).pack) {
    console.error("The datapack doesn't parse — run npm run datapack:validate first.");
    process.exit(1);
  }
  const pages = citedWikiPages(raw).slice(0, limit);
  mkdirSync(CACHE, { recursive: true });
  console.log(`Checking ${pages.length} cited wiki pages (about ${Math.ceil((pages.length * 3) / 60)} min)…`);
  const changed: string[] = [];
  const failed: string[] = [];
  for (const [i, url] of pages.entries()) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const file = cacheFile(url);
      const before = existsSync(file) ? articleFingerprint(readFileSync(file, "utf8")) : null;
      if (before !== articleFingerprint(html)) {
        changed.push(url);
        writeFileSync(file, html);
      }
    } catch (err) {
      failed.push(`${url} (${err instanceof Error ? err.message : String(err)})`);
    }
    if (i < pages.length - 1) await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(`\nChanged since last check (${changed.length}):`);
  changed.forEach((u) => console.log(`  ${u}`));
  if (failed.length) console.log(`\nCouldn't check (${failed.length}):\n  ${failed.join("\n  ")}`);
  writeFileSync(resolve(".tmp/wiki-refresh-report.txt"), [`Checked ${new Date().toISOString()}`, ...changed.map((u) => `CHANGED ${u}`), ...failed.map((f) => `FAILED ${f}`)].join("\n") + "\n");
  console.log("\nReport: .tmp/wiki-refresh-report.txt — review the changed pages and update the matching datapack records.");
}
