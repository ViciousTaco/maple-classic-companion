// @vitest-environment node
import { checkVideos } from "./check-videos";
import { unreviewedUpdates } from "./news-watch";
import type { Video } from "../src/data/schema/pack";

const video = (id: string, status: Video["status"] = "ok"): Video => ({
  id,
  title: "t",
  channel: "c",
  lang: "en",
  topics: [],
  appliesTo: "Founder's Access",
  addedAt: "2026-10-05",
  lastCheckedAt: "2026-10-05",
  status,
});

test("video check marks only clearly-gone videos as removed", async () => {
  const statuses: Record<string, number> = { AAAAAAAAAAA: 200, BBBBBBBBBBB: 404, CCCCCCCCCCC: 401 };
  const fake = (async (url: string) => {
    if (url.includes("DDDDDDDDDDD")) throw new Error("offline");
    const id = Object.keys(statuses).find((k) => url.includes(k))!;
    return new Response("{}", { status: statuses[id] });
  }) as typeof fetch;
  const r = await checkVideos([video("AAAAAAAAAAA"), video("BBBBBBBBBBB"), video("CCCCCCCCCCC"), video("DDDDDDDDDDD"), video("EEEEEEEEEEE", "removed")], fake, "2026-10-08");
  expect(r.removed).toEqual(["BBBBBBBBBBB", "CCCCCCCCCCC"]);
  expect(r.videos.map((v) => v.status)).toEqual(["ok", "removed", "removed", "ok", "removed"]);
  expect(r.videos[0]!.lastCheckedAt).toBe("2026-10-08");
}, 10_000);

test("news watch lists Classic 'Update' articles newer than the reviewed id", () => {
  const item = (id: number, name: string, isMSCW: boolean, category = "general") => ({ id, name, category, liveDate: "2026-10-08T00:00:00Z", isMSCW });
  const r = unreviewedUpdates(
    [
      item(45621, "Founder's Access Release Notes", true), // already reviewed
      item(45700, "MapleStory Classic World v1.0.1 Patch Notes", true),
      item(45701, "Classic World Maintenance", true, "maintenance"), // not an Update
      item(45702, "v.260 Patch Notes", false), // main game, not Classic
      { id: "bad" },
    ],
    45621,
  );
  expect(r.map((x) => x.id)).toEqual([45700]);
  expect(r[0]!.url).toBe("https://www.nexon.com/maplestory/news/general/45700");
});
