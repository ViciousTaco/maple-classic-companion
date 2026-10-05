import { sourcePack } from "../../data/fixtures/sourcePack";
import { searchAll } from "./CommandPalette";

const pack = sourcePack();

test("finds monsters, maps and items from the real guide data, best match first", () => {
  const hits = searchAll(pack, "blue mush");
  expect(hits[0]).toMatchObject({ kind: "monster", label: "Blue Mushroom", go: "/maps?q=Blue%20Mushroom" });
  expect(searchAll(pack, "henesys").some((h) => h.kind === "map" && h.label === "Henesys")).toBe(true);
  expect(searchAll(pack, "red potion")[0]).toMatchObject({ kind: "item", go: "/loot?q=Red%20Potion" });
});

test("screens are searchable and shown when the box is empty", () => {
  expect(searchAll(pack, "")[0]).toMatchObject({ kind: "screen", label: "Home" });
  expect(searchAll(pack, "sett")[0]).toMatchObject({ kind: "screen", go: "/settings" });
  expect(searchAll(pack, "zzzz-nothing")).toEqual([]);
});
