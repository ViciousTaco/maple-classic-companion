import { smallPack } from "../../../tests/fixtures/pack.small";
import { describePosition } from "./RouteView";
import { questUses, valueTier } from "./value";

test("portal positions read naturally", () => {
  expect(describePosition({ x: 2.2, y: 82 })).toBe("on the far left, near the bottom");
  expect(describePosition({ x: 97.2, y: 90.8 })).toBe("on the far right, near the bottom");
  expect(describePosition({ x: 50, y: 50 })).toBe("in the middle, halfway up");
  expect(describePosition({ x: 25, y: 10 })).toBe("on the left side, near the top");
});

test("value tiers come from relative NPC sell price and rarity; unknown stays plain", () => {
  const pack = smallPack((d) => {
    // 20 priced items: 10, 20, …, 200 meso
    d.items = d.items.concat(
      Array.from({ length: 20 }, (_, i) => ({ ...d.items[1]!, id: `p-${i}`, name: `Priced ${i}`, rarity: undefined, npcSellMeso: (i + 1) * 10 })),
    );
  });
  const item = (id: string) => pack.index.itemById.get(id)!;
  expect(valueTier(item("p-19"), pack)).toBe("gold"); // 200 — top 10 %
  expect(valueTier(item("p-15"), pack)).toBe("silver"); // 160 — top 25 %
  expect(valueTier(item("p-10"), pack)).toBe("bronze"); // 110 — top half
  expect(valueTier(item("p-0"), pack)).toBeNull(); // 10 — ordinary
  expect(valueTier(item("i-very-rare"), pack)).toBe("gold"); // rarity wins even without a price
  expect(valueTier(item("i-cap"), pack)).toBeNull(); // nothing known → plain
});

test("quest uses list quests that need the item", () => {
  const pack = smallPack((d) => {
    const { sources, confidence, verifiedAt } = d.monsters[0]!;
    d.npcs.push({ id: "npc", name: "Test NPC", mapId: "town", sources, confidence, verifiedAt });
    d.quests.push({
      id: "q-collect",
      name: "Test Collect",
      category: "regular",
      minLevel: 1,
      prereqQuestIds: [],
      startNpcId: "npc",
      steps: [{ text: "Bring 10", kind: "collect", itemId: "i-cap", qty: 10 }],
      rewards: {},
      sources,
      confidence,
      verifiedAt,
    });
  });
  expect(questUses("i-cap", pack).map((q) => q.id)).toEqual(["q-collect"]);
  expect(questUses("i-claw", pack)).toEqual([]);
});
