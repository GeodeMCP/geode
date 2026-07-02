import { expect, test } from "vitest";
import { relativeTime } from "./time";

const now = Date.parse("2026-01-01T12:00:00Z");
test("relativeTime buckets into just now / minutes / hours / days", () => {
  expect(relativeTime("2026-01-01T11:59:59Z", now)).toBe("just now");
  expect(relativeTime("2026-01-01T11:58:00Z", now)).toBe("2m ago");
  expect(relativeTime("2026-01-01T09:00:00Z", now)).toBe("3h ago");
  expect(relativeTime("2025-12-30T12:00:00Z", now)).toBe("2d ago");
});
