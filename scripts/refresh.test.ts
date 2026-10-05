// @vitest-environment node
import { articleFingerprint, citedWikiPages } from "./datapack-refresh";

test("collects each cited wiki page once, without anchors", () => {
  const raw = {
    monsters: [
      { sources: [{ url: "https://mapleclassic.wiki/wiki/Blue_Mushroom#Drops" }] },
      { sources: [{ url: "https://mapleclassic.wiki/wiki/Blue_Mushroom" }, { url: "https://www.nexon.com/x" }] },
    ],
    maps: [{ sources: [{ url: "https://mapleclassic.wiki/wiki/Henesys" }] }],
  };
  expect(citedWikiPages(raw)).toEqual(["https://mapleclassic.wiki/wiki/Blue_Mushroom", "https://mapleclassic.wiki/wiki/Henesys"]);
});

test("the fingerprint ignores page chrome outside the article body", () => {
  const body = '<div id="mw-content-text">Level 19</div><div class="printfooter">';
  expect(articleFingerprint(`views 10 ${body} edited today`)).toBe(articleFingerprint(`views 99 ${body} edited yesterday`));
  expect(articleFingerprint(body)).not.toBe(articleFingerprint(body.replace("19", "20")));
});
