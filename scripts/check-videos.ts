// Daily video check (P8-T5): YouTube oEmbed for each "ok" video; unavailable ones become "removed".
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Video } from "../src/data/schema/pack";

export async function checkVideos(videos: Video[], fetchFn: typeof fetch = fetch, today = new Date().toISOString().slice(0, 10)): Promise<{ videos: Video[]; removed: string[] }> {
  const removed: string[] = [];
  const out: Video[] = [];
  for (const v of videos) {
    if (v.status !== "ok") {
      out.push(v);
      continue;
    }
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${v.id}`)}`;
    // Network trouble is not evidence of removal.
    const gone = await fetchFn(url)
      .then((res) => res.status === 401 || res.status === 403 || res.status === 404)
      .catch(() => false);
    if (gone) removed.push(v.id);
    out.push({ ...v, status: gone ? "removed" : "ok", lastCheckedAt: today });
    await new Promise((r) => setTimeout(r, 500));
  }
  return { videos: out, removed };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const file = resolve("datapack/videos.json");
  const videos = JSON.parse(readFileSync(file, "utf8")) as Video[];
  const r = await checkVideos(videos);
  if (r.removed.length) {
    writeFileSync(file, JSON.stringify(r.videos, null, 2) + "\n");
    console.log(`Marked removed: ${r.removed.join(", ")}`);
  } else console.log(`All ${videos.length} videos still available.`);
}
