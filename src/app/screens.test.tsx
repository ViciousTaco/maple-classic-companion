import { act, screen } from "@testing-library/react";
import { profileInput, renderApp, ID_A } from "../test/renderApp";

// Smoke test: every screen renders on the real datapack for several characters, with no crash.
const ROUTES: [string, RegExp][] = [
  ["/home", /^Hey, /],
  ["/train", /^Train$/],
  ["/plan", /^Projections$/],
  ["/loot", /^Loot$/],
  ["/gear", /^Gear & stats$/],
  ["/quests", /^Quests$/],
  ["/news", /^News & events$/],
  ["/maps", /^Maps$/],
  ["/characters", /^Characters$/],
  [`/characters/${ID_A}`, /^Taco$/],
  ["/settings", /^Settings$/],
];

const CHARACTERS = [
  profileInput({ jobId: "beginner", level: 3 }),
  profileInput({ jobId: "thief", level: 23, combat: { damageMin: 40, damageMax: 90 }, stats: { hp: 900, luk: 60, dex: 25 } }),
  profileInput({ jobId: "cleric", level: 31, expPercent: 55, focus: "meso" }),
];

test.each(CHARACTERS.map((c) => [`${c.jobId} Lv ${c.level}`, c] as const))("every screen renders for a %s", async (_label, character) => {
  await renderApp([character]);
  for (const [route, heading] of ROUTES) {
    await act(async () => {
      window.location.hash = route;
    });
    expect(await screen.findByRole("heading", { level: 1, name: heading }, { timeout: 3000 })).toBeInTheDocument();
  }
}, 60_000);

test("Train shows a real recommendation from the guide data for a Lv 23 Thief", async () => {
  await renderApp([CHARACTERS[1]!]);
  await act(async () => {
    window.location.hash = "/train";
  });
  expect(await screen.findByText("Train here now")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /map taken/i })).toBeInTheDocument();
  expect(screen.getAllByText(/EXP \/ hour/).length).toBeGreaterThan(0);
});
