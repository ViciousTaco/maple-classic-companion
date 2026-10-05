import { buildNote, parseMeowdbUrl } from "./QuickNote";

test("recognises exact MeowDB record links only", () => {
  expect(parseMeowdbUrl("https://meowdb.com/msclassic/monsters/1210102")).toEqual({ kind: "monster", id: "1210102" });
  expect(parseMeowdbUrl(" https://www.meowdb.com/msclassic/maps/100000000?x=1 ")).toEqual({ kind: "map", id: "100000000" });
  expect(parseMeowdbUrl("https://meowdb.com/msclassic/item-db/2000000/")).toEqual({ kind: "item", id: "2000000" });
  expect(parseMeowdbUrl("https://meowdb.com/msclassic/quest-tracker/1021")).toEqual({ kind: "quest", id: "1021" });
  expect(parseMeowdbUrl("https://meowdb.com/msclassic/monsters/blue-mushroom")).toBeNull();
  expect(parseMeowdbUrl("https://evil.example/meowdb.com/msclassic/monsters/1")).toBeNull();
  expect(parseMeowdbUrl("https://meowdb.com/gms/monsters/1")).toBeNull();
});

test("a note records text, source, character and context", () => {
  const note = buildNote({
    text: "  Blue Mushroom Lv 19  ",
    url: "https://meowdb.com/msclassic/monsters/2220100",
    character: { name: "Taco", level: 23, jobId: "bandit" },
    screen: "/train",
    packVersion: "2026.10.05-1",
    imageCount: 2,
    now: new Date("2026-10-07T01:00:00.000Z"),
  });
  expect(note).toMatchObject({
    format: "mcc-field-note",
    text: "Blue Mushroom Lv 19",
    meowdb: { kind: "monster", id: "2220100" },
    character: { name: "Taco", level: 23 },
    imageCount: 2,
    createdAt: "2026-10-07T01:00:00.000Z",
  });
});
