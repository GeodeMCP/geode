import { expect, test } from "vitest";
import { mintSecretLink, verifySecretLink } from "../../src/dashboard/secretLinks.js";

const key = Buffer.from("k".repeat(32));

test("mint → verify round-trip returns the ref; tampered/expired/garbage fail", () => {
  const now = 1_000_000;
  const tok = mintSecretLink(key, "NOTION_TOKEN", 60_000, () => now);
  const claims = verifySecretLink(key, tok, () => now);
  expect(claims?.ref).toBe("NOTION_TOKEN");
  expect(typeof claims?.nonce).toBe("string");
  expect(verifySecretLink(key, tok + "x", () => now)).toBeNull();        // tampered sig
  expect(verifySecretLink(key, tok, () => now + 61_000)).toBeNull();      // expired
  expect(verifySecretLink(key, "not-a-token", () => now)).toBeNull();     // garbage
});

test("each mint has a distinct nonce (single-use is enforced by the caller via the nonce)", () => {
  const a = mintSecretLink(key, "K", 60_000);
  const b = mintSecretLink(key, "K", 60_000);
  expect(verifySecretLink(key, a)!.nonce).not.toBe(verifySecretLink(key, b)!.nonce);
});
