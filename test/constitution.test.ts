import { expect, test } from "vitest";
import { CONSTITUTION } from "../src/constitution.js";

test("constitution instructs maintaining the structural files and inheritance rules", () => {
  expect(CONSTITUTION).toContain("index.md");
  expect(CONSTITUTION).toContain("capabilities.md");
  expect(CONSTITUTION).toContain("AGENTS.md");
  expect(CONSTITUTION.toLowerCase()).toContain("canonical");
  expect(CONSTITUTION.toLowerCase()).toContain("cascade");
});
