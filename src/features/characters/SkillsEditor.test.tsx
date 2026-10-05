import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { baselineRules } from "../../data/gameRules";
import { SkillsEditor, type SkillDef } from "./SkillsEditor";

// Synthetic fixture names so nobody mistakes them for game data.
const FIXTURE: SkillDef[] = [
  { id: "test-beginner-skill", name: "Test Beginner Skill", jobId: "beginner", maxLevel: 3 },
  { id: "test-thief-skill", name: "Test Thief Skill", jobId: "thief", maxLevel: 20 },
  { id: "test-bandit-skill", name: "Test Bandit Skill", jobId: "bandit", maxLevel: 20 },
  { id: "test-mage-skill", name: "Test Mage Skill", jobId: "magician", maxLevel: 20 },
];

function Harness() {
  const [values, setValues] = useState<Record<string, number>>({});
  return (
    <>
      <SkillsEditor rules={baselineRules} skills={FIXTURE} jobId="bandit" values={values} onChange={setValues} />
      <output data-testid="values">{JSON.stringify(values)}</output>
    </>
  );
}

test("lists the job line's skills (plus Beginner) with 0…max steppers", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  expect(screen.getByText("Test Bandit Skill")).toBeInTheDocument();
  expect(screen.getByText("Test Thief Skill")).toBeInTheDocument();
  expect(screen.getByText("Test Beginner Skill")).toBeInTheDocument();
  expect(screen.queryByText("Test Mage Skill")).toBeNull();

  const inc = screen.getByRole("button", { name: "Increase Test Beginner Skill level" });
  for (let i = 0; i < 5; i++) await user.click(inc);
  expect(screen.getByTestId("values")).toHaveTextContent('{"test-beginner-skill":3}');
  expect(inc).toBeDisabled();
});
