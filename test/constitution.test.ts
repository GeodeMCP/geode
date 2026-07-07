import { expect, test } from "vitest";
import { CONSTITUTION, fragmentFor } from "../src/constitution.js";

test("constitution adopts OKF + the locked role", () => {
  expect(CONSTITUTION).toContain("overlay");
  expect(CONSTITUTION).toContain("index.md");
  expect(CONSTITUTION.toLowerCase()).toContain("frontmatter");      // OKF
  expect(CONSTITUTION.toLowerCase()).toContain("canonical");
  expect(CONSTITUTION.toLowerCase()).toContain("never");            // never execute / never call integrations
  expect(CONSTITUTION).toContain("invoke");                          // returns invoke-plans
});

test("the constitution tells the agent to log missing capabilities as gaps", () => {
  expect(CONSTITUTION).toContain("backlog/");
  expect(CONSTITUTION).toContain("type: gap");
});

test("desk fragment adds terseness; librarian fragment does not", () => {
  const desk = fragmentFor("desk");
  const librarian = fragmentFor("librarian");
  expect(desk.toLowerCase()).toContain("minimal");
  expect(desk.toLowerCase()).toContain("no section headers");
  expect(librarian.toLowerCase()).not.toContain("no section headers");
});

test("the core (constitution) carries neither role's terseness rule", () => {
  expect(CONSTITUTION.toLowerCase()).not.toContain("no section headers");
});
