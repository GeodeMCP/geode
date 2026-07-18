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

test("renderAuthScreen splits a composite ref into key + tool·connection context, not the raw ref", () => {
  const html = renderAuthScreen({ ref: "moneybird__roverm__API_TOKEN", action: "/auth/s/x", minutesLeft: 5 });
  expect(html).toContain("API_TOKEN");                        // key is the heading
  expect(html).toContain("moneybird");                        // tool as context
  expect(html).toContain("roverm");                           // connection as context
  expect(html).not.toContain("moneybird__roverm__API_TOKEN"); // the raw composite ref is never shown
  expect(html).toContain("Save secret");                      // button label
});

test("renderAuthResult reflects success/failure and shows the key, not the raw ref", () => {
  const ok = renderAuthResult({ ok: true, ref: "httpbin__default__DEMO_KEY", message: "opgeslagen" });
  expect(ok).toContain("opgeslagen");
  expect(ok).toContain("DEMO_KEY");
  expect(ok).not.toContain("httpbin__default__DEMO_KEY");
  expect(renderAuthResult({ ok: false, ref: "", message: "verlopen" })).toContain("verlopen");
});
