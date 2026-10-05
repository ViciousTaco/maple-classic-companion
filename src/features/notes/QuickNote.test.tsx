import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { profileInput, renderApp } from "../../test/renderApp";

test("Ctrl+N opens a quick note that saves text, link and character into the inbox", async () => {
  const user = userEvent.setup();
  const { platform } = await renderApp([profileInput()]);
  await user.keyboard("{Control>}n{/Control}");
  const text = await screen.findByLabelText("What did you see?");
  await user.type(text, "Blue Mushroom Lv 19, 35 EXP");
  await user.type(screen.getByLabelText("Source link (optional)"), "https://meowdb.com/msclassic/monsters/2220100");
  expect(screen.getByText(/MeowDB monster #2220100 recognised/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(await screen.findByText("Note saved")).toBeInTheDocument();
  const [note] = [...platform.notes.values()];
  expect(JSON.parse(note!.json)).toMatchObject({
    text: "Blue Mushroom Lv 19, 35 EXP",
    meowdb: { kind: "monster", id: "2220100" },
    character: { name: "Taco", level: 23, jobId: "thief" },
  });
});

test("an empty note can't be saved", async () => {
  const user = userEvent.setup();
  await renderApp([profileInput()]);
  await user.click(screen.getByRole("button", { name: /quick note/i }));
  expect(await screen.findByRole("button", { name: "Save note" })).toBeDisabled();
});
