import { expect, test } from "vitest";
import { CONSTITUTION, fragmentFor } from "../src/constitution.js";

test("constitution adopts OKF + the locked role", () => {
  expect(CONSTITUTION).toContain("overlay");
  expect(CONSTITUTION).toContain("index.md");
  expect(CONSTITUTION.toLowerCase()).toContain("frontmatter");      // OKF
  expect(CONSTITUTION.toLowerCase()).toContain("canonical");
  expect(CONSTITUTION.toLowerCase()).toContain("never");            // never execute / never call integrations
  expect(CONSTITUTION).toContain("invoke");                          // returns invoke-plans
  expect(CONSTITUTION).not.toContain("log.md");                     // hand log retired
  expect(CONSTITUTION.toLowerCase()).toContain("generated");        // index.md/graph.json are generated
  expect(CONSTITUTION).not.toContain("keep index.md current");      // old hand-maintenance instruction is gone
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

test("librarian fragment teaches capability-graph linking at write time", () => {
  const librarian = fragmentFor("librarian");
  const lc = librarian.toLowerCase();
  expect(lc).toContain("link");         // instructs linking of dependencies
  expect(lc).toContain("graph");        // frames links as the capability graph
  expect(lc).toContain("uses");         // the sop→tool `uses` edge
  expect(librarian).toContain("tools/"); // teaches a resolvable relative link to a tool
});
