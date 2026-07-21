import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The human-approved host set for one tool. Lives under toolsDir (trusted side), never in the vault or git. */
export interface ApprovalRecord { approvedHosts: string[]; updatedAt: string }

const recPath = (toolsDir: string, id: string) => join(toolsDir, id, "hosts.json");

/** Reads a tool's approved-hosts record, or an empty record when none exists or the file is malformed. */
export async function readApproval(toolsDir: string, id: string): Promise<ApprovalRecord> {
  try {
    const parsed: unknown = JSON.parse(await readFile(recPath(toolsDir, id), "utf8"));
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as ApprovalRecord).approvedHosts)) {
      return parsed as ApprovalRecord;
    }
    return { approvedHosts: [], updatedAt: "" };
  } catch { return { approvedHosts: [], updatedAt: "" }; }
}

/** Persists a mutated record. */
async function write(toolsDir: string, id: string, hosts: string[]): Promise<ApprovalRecord> {
  const rec: ApprovalRecord = { approvedHosts: [...new Set(hosts)].sort(), updatedAt: new Date().toISOString() };
  await mkdir(join(toolsDir, id), { recursive: true });
  await writeFile(recPath(toolsDir, id), JSON.stringify(rec, null, 2));
  return rec;
}

/** Adds a host (lowercased) to a tool's approved set. */
export async function approveHost(toolsDir: string, id: string, host: string): Promise<ApprovalRecord> {
  const cur = await readApproval(toolsDir, id);
  return write(toolsDir, id, [...cur.approvedHosts, host.toLowerCase()]);
}

/** Removes a host from a tool's approved set. */
export async function revokeHost(toolsDir: string, id: string, host: string): Promise<ApprovalRecord> {
  const cur = await readApproval(toolsDir, id);
  return write(toolsDir, id, cur.approvedHosts.filter((h) => h !== host.toLowerCase()));
}
