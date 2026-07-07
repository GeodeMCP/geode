import { describe, it, expect } from "vitest";
import { pendingSetup } from "./setup";

describe("pendingSetup", () => {
  it("lists unconfigured connections with their exact secret refs", () => {
    const tools = [{ id: "moneybird", requires: ["api-token"], connections: [
      { label: "roverm", configured: false }, { label: "mijnwebontwikkelaar", configured: true },
    ] }] as any;
    expect(pendingSetup(tools)).toEqual([{ tool: "moneybird", connection: "roverm", refs: ["moneybird__roverm__api-token"] }]);
  });
});
