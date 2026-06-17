import { expect, test } from "vitest";
import { kernelName } from "../src/smoke.js";

test("smoke: package wired", () => {
  expect(kernelName).toBe("geode-kernel");
});
