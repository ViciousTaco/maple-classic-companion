import { smallPack, testProfile } from "../../../tests/fixtures/pack.small";
import { parseMiniAction, profileChange } from "./actions";

const pack = smallPack((d) => {
  d.quests.push({
    id: "q-test",
    name: "Test quest",
    category: "regular",
    minLevel: 1,
    startNpcId: "npc-x",
    steps: [
      { text: "Talk", kind: "talk" },
      { text: "Kill", kind: "kill" },
    ],
    rewards: {},
    sources: [{ kind: "wiki", label: "w", retrievedAt: "2026-10-05" }],
    confidence: "likely",
  } as never);
});
const now = new Date("2026-10-07T00:00:00Z");

test("only well-formed actions are accepted", () => {
  expect(parseMiniAction({ kind: "skip-spot", payload: { profileId: "a", spotId: "s" } })).toMatchObject({ kind: "skip-spot" });
  expect(parseMiniAction({ kind: "quest-step", payload: { profileId: "a", questId: "q", step: 1.5 } })).toBeNull();
  expect(parseMiniAction({ kind: "delete-everything" })).toBeNull();
  expect(parseMiniAction("nope")).toBeNull();
});

test("skip a spot for 90 minutes, and tick quest steps through to done", () => {
  const p = testProfile();
  const skipped = profileChange({ kind: "skip-spot", payload: { profileId: p.id, spotId: "spot-exp" } }, pack, now)!(p);
  expect(skipped.skippedSpots).toEqual([{ spotId: "spot-exp", until: "2026-10-07T01:30:00.000Z" }]);
  const tick = (prof: typeof p, step: number) => profileChange({ kind: "quest-step", payload: { profileId: p.id, questId: "q-test", step } }, pack, now)!(prof);
  const one = tick(p, 0);
  expect(one.unlocks.questsActive).toEqual(["q-test"]);
  const both = tick(one, 1);
  expect(both.unlocks.questsDone).toEqual(["q-test"]);
  expect(both.unlocks.questsActive).toEqual([]);
  expect(profileChange({ kind: "quest-step", payload: { profileId: p.id, questId: "q-test", step: 5 } }, pack, now)).toBeNull();
});
