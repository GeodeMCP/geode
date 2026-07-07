import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { composeSystemPrompt } from "../src/query.js";

const deps = (): any => ({
  systemPrompt: "CORE-RULES",
  workspace: { root: mkdtempSync(join(tmpdir(), "geode-prompt-")) },
});

test("desk prompt = core + desk terseness; librarian prompt omits it", () => {
  const d = deps();
  const desk = composeSystemPrompt(d, "desk");
  const librarian = composeSystemPrompt(d, "librarian");
  expect(desk).toContain("CORE-RULES");
  expect(desk.toLowerCase()).toContain("no section headers");
  expect(librarian).toContain("CORE-RULES");
  expect(librarian.toLowerCase()).not.toContain("no section headers");
});
