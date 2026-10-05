// News watch (P8-T5): prints "id<TAB>title<TAB>url" for Classic World "Update" articles newer than
// meta.reviewedThroughArticleId. One polite request to Nexon's public CMS index (D-6).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { API, classify, matchReason, validateItem } from "../src/features/news/core";
import pkg from "../package.json" with { type: "json" };

export type Unreviewed = { id: number; title: string; url: string };

export function unreviewedUpdates(items: unknown[], reviewedThrough: number): Unreviewed[] {
  const out: Unreviewed[] = [];
  for (const raw of items) {
    let item;
    try {
      item = validateItem(raw);
    } catch {
      continue;
    }
    if (item.id <= reviewedThrough || !matchReason(item)) continue;
    if (classify(item) !== "Update") continue;
    out.push({ id: item.id, title: item.name, url: `https://www.nexon.com/maplestory/news/${item.category ?? "general"}/${item.id}` });
  }
  return out.sort((a, b) => a.id - b.id);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const meta = JSON.parse(readFileSync(resolve("datapack/meta.json"), "utf8")) as { reviewedThroughArticleId: number };
  const res = await fetch(`${API}/news`, { headers: { "User-Agent": `MapleClassicCompanion/${pkg.version} (personal news reader; news-watch)` } });
  if (!res.ok) {
    console.error(`Nexon news index answered HTTP ${res.status}`);
    process.exit(0); // never fail the workflow on Nexon outages
  }
  const items = (await res.json()) as unknown[];
  for (const u of unreviewedUpdates(Array.isArray(items) ? items : [], meta.reviewedThroughArticleId)) {
    console.log(`${u.id}\t${u.title.replace(/[\t\n]/g, " ")}\t${u.url}`);
  }
}
