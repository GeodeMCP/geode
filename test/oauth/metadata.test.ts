import { expect, test } from "vitest";
import { protectedResourceMetadata, authorizationServerMetadata } from "../../src/oauth/metadata.js";

test("protected-resource metadata points at the AS and the /mcp resource", () => {
  const m = protectedResourceMetadata("https://v.example.com");
  expect(m.resource).toBe("https://v.example.com/mcp");
  expect(m.authorization_servers).toEqual(["https://v.example.com"]);
  expect(m.scopes_supported).toContain("vault");
});

test("authorization-server metadata exposes endpoints + S256 + iss", () => {
  const m = authorizationServerMetadata("https://v.example.com");
  expect(m.issuer).toBe("https://v.example.com");
  expect(m.authorization_endpoint).toBe("https://v.example.com/authorize");
  expect(m.token_endpoint).toBe("https://v.example.com/token");
  expect(m.registration_endpoint).toBe("https://v.example.com/register");
  expect(m.code_challenge_methods_supported).toEqual(["S256"]);
  expect(m.authorization_response_iss_parameter_supported).toBe(true);
});
