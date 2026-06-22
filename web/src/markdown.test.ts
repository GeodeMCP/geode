import { expect, test } from "vitest";
import { renderMarkdown, splitFrontmatter } from "./markdown";

test("renderMarkdown renders markdown and strips scripts", () => {
  const html = renderMarkdown("# Title\n\nHello **world**");
  expect(html).toContain("<h1");
  expect(html).toContain("<strong>world</strong>");
  expect(renderMarkdown("ok<script>alert(1)</script>")).not.toContain("<script>");
});

test("splitFrontmatter separates OKF frontmatter from the body", () => {
  const { fm, body } = splitFrontmatter("---\ntype: note\ntitle: X\n---\n\n# Body");
  expect(fm.type).toBe("note");
  expect(fm.title).toBe("X");
  expect(body.trim()).toBe("# Body");
  expect(splitFrontmatter("# No fm").fm).toEqual({});
});

test("splitFrontmatter tolerates CRLF and hyphenated keys", () => {
  const { fm, body } = splitFrontmatter("---\r\ntype: note\r\nsome-key: v\r\n---\r\n\r\n# Body");
  expect(fm.type).toBe("note");
  expect(fm["some-key"]).toBe("v");
  expect(body).toContain("# Body");
});
