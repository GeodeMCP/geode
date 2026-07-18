import { expect, test } from "vitest";
import { buildAttachmentNote } from "../src/query.js";

test("empty when there are no attachment dirs", () => {
  expect(buildAttachmentNote(undefined, undefined)).toBe("");
  expect(buildAttachmentNote([], ["a.md"])).toBe("");
});

test("names the staging dir, lists the staged files, and keeps the onboarding guidance", () => {
  const note = buildAttachmentNote(["/Users/x/.geode/uploads"], ["epicwp/pricing.md", "epicwp/data.csv"]);
  expect(note).toContain("/Users/x/.geode/uploads");
  expect(note).toContain("epicwp/pricing.md");
  expect(note).toContain("epicwp/data.csv");
  expect(note.toLowerCase()).toContain("onboard-workspace skill");
});

test("inlines the onboarding forcing function (reframe + anti-mirror + mapping table), not just a skill pointer", () => {
  const note = buildAttachmentNote(["/Users/x/.geode/uploads"], ["a.md"]);
  const lc = note.toLowerCase();
  expect(lc).toContain("translating");                                  // verb reframe, present even if the skill is never read
  expect(lc).toContain("a source folder never becomes a vault folder"); // the hard anti-mirror rule
  expect(lc).toContain("mapping table");                                // the required content-first artifact
  expect(lc).toContain("what concept is this");                         // the column that makes the source path unrepresentable
  expect(lc).toContain("under any label");                              // closes the "keep it as reference/snapshot" loophole
  expect(lc).toContain("onboard-workspace skill");                      // still points to the skill for full detail
});

test("warns against skipping dotfiles (the .geode-under-a-hidden-dir trap)", () => {
  const note = buildAttachmentNote(["/Users/x/.geode/uploads"], ["pricing.md"]);
  expect(note).toContain(".geode");
  expect(note.toLowerCase()).toContain("dotfile");
});

test("caps a very long list and reports the remainder", () => {
  const files = Array.from({ length: 130 }, (_, i) => `f${i}.md`);
  const note = buildAttachmentNote(["/d"], files);
  expect(note).toContain("f0.md");     // first shown
  expect(note).toContain("f99.md");    // last within the 100 cap
  expect(note).not.toContain("f120.md"); // beyond the cap
  expect(note).toContain("and 30 more");
});
