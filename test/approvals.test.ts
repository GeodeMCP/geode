import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readApproval, approveHost, revokeHost } from "../src/approvals.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "geode-appr-")); });

describe("approvals store", () => {
  it("reads an empty record when none exists", async () => {
    expect(await readApproval(dir, "moneybird")).toEqual({ approvedHosts: [], updatedAt: "" });
  });

  it("approves a host (lowercased) and reads it back", async () => {
    await approveHost(dir, "moneybird", "API.Moneybird.nl");
    expect((await readApproval(dir, "moneybird")).approvedHosts).toEqual(["api.moneybird.nl"]);
  });

  it("does not duplicate an already-approved host", async () => {
    await approveHost(dir, "moneybird", "api.moneybird.nl");
    const rec = await approveHost(dir, "moneybird", "api.moneybird.nl");
    expect(rec.approvedHosts).toEqual(["api.moneybird.nl"]);
  });

  it("revokes a host", async () => {
    await approveHost(dir, "moneybird", "api.moneybird.nl");
    const rec = await revokeHost(dir, "moneybird", "api.moneybird.nl");
    expect(rec.approvedHosts).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it("treats a malformed record (approvedHosts not an array) as empty instead of fail-open", async () => {
    await mkdir(join(dir, "moneybird"), { recursive: true });
    await writeFile(join(dir, "moneybird", "hosts.json"), JSON.stringify({ approvedHosts: "evil.com" }));
    expect(await readApproval(dir, "moneybird")).toEqual({ approvedHosts: [], updatedAt: "" });
  });
});
