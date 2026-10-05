import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ID_A, ID_B, profileInput, renderApp } from "../../test/renderApp";
import { activeProfile } from "./store";
import { ProfileSchema } from "../../data/schema/profile";
import { useToasts } from "../../ui/overlays";

afterEach(() => {
  act(() => useToasts.setState({ toasts: [] }));
});

// ---- P2-T4 first-run wizard ----
test("completing the 3 wizard steps creates a valid profile and sets it active", async () => {
  const user = userEvent.setup();
  const { store } = await renderApp();
  await user.type(screen.getByLabelText("Character name"), "Taco");
  await user.click(screen.getByRole("radio", { name: "Thief" }));
  await user.click(screen.getByRole("button", { name: /next/i }));

  const level = screen.getByRole("spinbutton", { name: "Level" });
  await user.clear(level);
  await user.type(level, "31");
  await user.selectOptions(screen.getByLabelText("Job"), "bandit");
  await user.click(screen.getByRole("button", { name: /next/i }));

  await user.click(screen.getByRole("radio", { name: "Meso" }));
  await user.click(screen.getByRole("button", { name: "Start" }));

  const p = activeProfile(store.getState());
  expect(p).toMatchObject({ name: "Taco", jobId: "bandit", level: 31, focus: "meso" });
  expect(ProfileSchema.safeParse(p).success).toBe(true);
  expect(await screen.findByRole("heading", { name: /hey, taco/i })).toBeInTheDocument();
});

test("the wizard won't continue without a name and offers only Beginner below Lv 10", async () => {
  const user = userEvent.setup();
  await renderApp();
  expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  await user.type(screen.getByLabelText("Character name"), "Low");
  await user.click(screen.getByRole("radio", { name: "Warrior" }));
  await user.click(screen.getByRole("button", { name: /next/i }));
  const options = within(screen.getByLabelText("Job")).getAllByRole("option");
  expect(options.map((o) => o.textContent)).toEqual(["Beginner"]);
  expect(screen.getByText(/You can become a Warrior at Lv 10/)).toBeInTheDocument();
});

// ---- P2-T3 characters screen ----
test("create, switch and delete-with-undo on the Characters screen", async () => {
  const user = userEvent.setup();
  const { store, platform } = await renderApp([profileInput(), profileInput({ id: ID_B, name: "Mage", jobId: "magician", level: 12 })]);
  window.location.hash = "#/characters";
  await screen.findByRole("heading", { name: "Characters" });

  // switch
  const mage = screen.getByRole("article", { name: "Mage" });
  await user.click(within(mage).getByRole("button", { name: "Switch to" }));
  expect(store.getState().file.activeProfileId).toBe(ID_B);

  // delete → undo
  window.location.hash = "#/characters";
  const taco = await screen.findByRole("article", { name: "Taco" });
  await user.click(within(taco).getByRole("button", { name: "Delete" }));
  await user.click(await screen.findByRole("button", { name: "Delete" }));
  expect(store.getState().file.profiles.map((p) => p.name)).toEqual(["Mage"]);
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  expect(store.getState().file.profiles.map((p) => p.name)).toEqual(["Taco", "Mage"]);

  // create
  await user.click(screen.getByRole("button", { name: /new character/i }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("Character name"), "Third");
  await user.click(within(dialog).getByRole("button", { name: /next/i }));
  await user.click(within(dialog).getByRole("button", { name: /next/i }));
  await user.click(within(dialog).getByRole("button", { name: "Start" }));
  expect(store.getState().file.profiles.map((p) => p.name)).toEqual(["Taco", "Mage", "Third"]);

  await store.getState().flush();
  expect(platform.saves.length).toBeGreaterThan(0);
});

test("a deleted character's screenshot is removed only after the undo window", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const { store, platform } = await renderApp([
      profileInput({ screenshot: { file: `${ID_A}.webp`, updatedAt: "2026-10-05T10:00:00.000Z" } }),
      profileInput({ id: ID_B, name: "Other" }),
    ]);
    await platform.screenshotSave(ID_A, new Uint8Array([1, 2, 3]));
    window.location.hash = "#/characters";
    const taco = await screen.findByRole("article", { name: "Taco" });
    fireEvent.click(within(taco).getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(store.getState().file.profiles).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(await platform.screenshotRead(ID_A)).not.toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    await waitFor(async () => expect(await platform.screenshotRead(ID_A)).toBeNull());
  } finally {
    vi.useRealTimers();
  }
});

// ---- P2-T5 character sheet ----
test("at Lv 9 only Beginner is offered; at Lv 30 a Thief can pick Assassin or Bandit", async () => {
  const user = userEvent.setup();
  const { store } = await renderApp([profileInput({ jobId: "beginner", level: 9 })]);
  window.location.hash = `#/characters/${ID_A}`;
  const job = await screen.findByLabelText("Job");
  expect(within(job).getAllByRole("option").map((o) => o.textContent)).toEqual(["Beginner"]);

  act(() => store.getState().updateProfile(ID_A, (p) => ({ ...p, jobId: "thief", level: 30 })));
  const mine = within(screen.getByLabelText("Job")).getByRole("group", { name: "Your class line" });
  expect(within(mine).getAllByRole("option").map((o) => o.textContent)).toEqual(["Thief", "Assassin", "Bandit"]);
  await user.selectOptions(screen.getByLabelText("Job"), "assassin");
  expect(activeProfile(store.getState())?.jobId).toBe("assassin");
});

test("sheet sections start collapsed except Identity, and stats save", async () => {
  const user = userEvent.setup();
  const { store } = await renderApp([profileInput()]);
  window.location.hash = `#/characters/${ID_A}`;
  const stats = await screen.findByRole("button", { name: /^Stats/ });
  expect(stats).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: /^Identity/ })).toHaveAttribute("aria-expanded", "true");
  await user.click(stats);
  await user.type(screen.getByLabelText("LUK"), "120");
  expect(activeProfile(store.getState())?.stats.luk).toBe(120);
});

test("a too-high job for the level shows a soft warning but still saves", async () => {
  const { store } = await renderApp([profileInput({ jobId: "bandit", level: 25 })]);
  window.location.hash = `#/characters/${ID_A}`;
  expect(await screen.findByText(/Bandit is available from Lv 30/)).toBeInTheDocument();
  expect(activeProfile(store.getState())?.jobId).toBe("bandit");
});

// ---- P2-T7 skills editor ----
test("with no skill data the sheet says so instead of inventing skills", async () => {
  const user = userEvent.setup();
  await renderApp([profileInput()]);
  window.location.hash = `#/characters/${ID_A}`;
  await user.click(await screen.findByRole("button", { name: /^Skills/ }));
  expect(screen.getByText("Skill details are not in the guide data yet")).toBeInTheDocument();
});
