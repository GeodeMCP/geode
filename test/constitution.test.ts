import { expect, test } from "vitest";
import { CONSTITUTION } from "../src/constitution.js";

test("constitution adopts OKF + the locked role", () => {
  expect(CONSTITUTION).toContain("overlay");
  expect(CONSTITUTION).toContain("index.md");
  expect(CONSTITUTION.toLowerCase()).toContain("frontmatter");      // OKF
  expect(CONSTITUTION.toLowerCase()).toContain("canonical");
  expect(CONSTITUTION.toLowerCase()).toContain("never");            // never execute / never call integrations
  expect(CONSTITUTION).toContain("invoke");                          // returns invoke-plans
});
