import { expect, test } from "vitest";
import { renderAuthScreen, renderAuthResult } from "../../src/dashboard/authScreen.js";

test("renderAuthScreen shows the ref, posts to the action URL, has a value field, and never echoes a value", () => {
  const html = renderAuthScreen({ ref: "NOTION_TOKEN", action: "/auth/s/abc", minutesLeft: 9 });
  expect(html).toContain("NOTION_TOKEN");
  expect(html).toContain('action="/auth/s/abc"');
  expect(html).toContain('method="post"');
  expect(html).toContain('name="value"');
  expect(html).toContain("9 min");
});

test("renderAuthResult reflects success/failure", () => {
  expect(renderAuthResult({ ok: true, ref: "K", message: "opgeslagen" })).toContain("opgeslagen");
  expect(renderAuthResult({ ok: false, ref: "", message: "verlopen" })).toContain("verlopen");
});
