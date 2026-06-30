import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SecretStore } from "./secrets.js";

/** How a tool's actions are executed server-side (the caller never sees the difference). */
export type ToolType = "http" | "cli" | "mcp";
/** A named credentialed instance of a tool; secret values live in the store, not here. */
export interface ToolConnection { label: string; description?: string }
/** One parameter of a tool action. */
export interface ToolParam { name: string; required: boolean }
/** HTTP request shape for an `http`-type action. */
export interface HttpAction { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"; url: string; headers?: Record<string,string>; query?: Record<string,string>; body?: unknown }
/** One callable action; executor-specific fields vary by tool `type`. `command` is a per-element argv array, each token template-resolved independently. */
export interface ToolAction { description?: string; params?: ToolParam[]; http?: HttpAction; command?: string[]; remote_tool?: string }
/** A vault tool: one manifest, one or more connections, one `invoke` door regardless of executor. */
export interface ToolManifest {
  id: string; name: string; type: ToolType; description: string;
  runtime?: "host" | "container";
  requires?: string[];
  connections?: ToolConnection[];
  actions: Record<string, ToolAction>;
  source?: { repo?: string; package?: string; ref?: string };
  install?: string[];
  bin?: string;
  materialize?: { inject: "env" | "profile"; env?: Record<string,string>; profile?: { restore: string; into: string } };
  transport?: { kind: "stdio" | "http"; command?: string; url?: string; ref?: string };
  image?: { base: string };
  permissions?: { network?: "none" | "any" | string[]; filesystem?: string[] };
  limits?: { timeoutMs?: number; memoryMb?: number; cpus?: number };
  body?: string;
}

const ID_RE = /^[a-z0-9-]+$/;

/** Reads and parses `tools/<id>/TOOL.md` (YAML frontmatter + markdown body); rejects unsafe ids. */
export async function loadTool(root: string, id: string): Promise<ToolManifest> {
  if (!ID_RE.test(id)) throw new Error(`invalid tool id: ${id}`);
  const raw = await readFile(join(root, "tools", id, "TOOL.md"), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`tool ${id}: missing frontmatter`);
  const fm = (parseYaml(m[1]) ?? {}) as Partial<ToolManifest>;
  if (!fm.type || !fm.actions) throw new Error(`tool ${id}: frontmatter needs type + actions`);
  for (const [name, action] of Object.entries(fm.actions)) {
    if (action.command !== undefined && (!Array.isArray(action.command) || action.command.length === 0 || !action.command.every((t) => typeof t === "string")))
      throw new Error(`tool ${id}: action "${name}" — command must be a non-empty array of argv tokens (string[]); the space-separated string form was removed`);
  }
  return { ...fm, id, name: fm.name ?? id, description: fm.description ?? "", type: fm.type, actions: fm.actions, body: m[2] || undefined } as ToolManifest;
}

/** Lists tool ids = directory names under `tools/`. */
export async function listToolIds(root: string): Promise<string[]> {
  try { return (await readdir(join(root, "tools"), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
}

/** Splits a tool's `bin` interpreter prefix into argv tokens (static — never template-resolved, so it can't carry a credential onto the process list). */
export function binTokens(bin: string | undefined): string[] {
  return bin ? bin.trim().split(/\s+/) : [];
}

/** Replaces `${params.key}` and `${conn.key}` placeholders, throwing if any reference is unresolved. */
export function resolveTemplate(input: string, ctx: { params: Record<string, unknown>; conn: Record<string, string> }): string {
  return input.replace(/\$\{(params|conn)\.([\w-]+)\}/g, (_m, ns: string, k: string) => {
    const v = ns === "params" ? ctx.params[k] : ctx.conn[k];
    if (v === undefined || v === null) throw new Error(`unresolved template reference: \${${ns}.${k}}`);
    return String(v);
  });
}

/** The flat secret-store ref for one connection's one secret key. */
export function connRef(tool: string, label: string, key: string): string { return `${tool}__${label}__${key}`; }

/** Picks the connection label to use: explicit (must be valid), the lone default, or throws if ambiguous. */
export function resolveConnection(connections: ToolConnection[], requested: string | undefined): string | undefined {
  if (requested !== undefined) {
    if (!connections.some((c) => c.label === requested)) throw new Error(`'${requested}' is not a connection of this tool; available: ${connections.map((c) => c.label).join(", ") || "(none)"}`);
    return requested;
  }
  if (connections.length === 1) return connections[0].label;
  if (connections.length === 0) return undefined;
  throw new Error(`specify a connection: ${connections.map((c) => c.label).join(", ")}`);
}

/** Resolves all `requires` secret keys for one connection into a `${conn.X}` map; throws if any is unset. */
export async function loadConnBundle(store: Pick<SecretStore, "get">, tool: string, label: string | undefined, requires: string[]): Promise<Record<string, string>> {
  const conn: Record<string, string> = {};
  for (const key of requires) {
    const v = label === undefined ? null : await store.get(connRef(tool, label, key));
    if (v === null) {
      const hint = label === undefined ? `missing ${key}` : `run \`npm run secret -- set ${connRef(tool, label, key)}\``;
      throw new Error(`connection '${label ?? "(none)"}' needs setup for ${tool}: ${hint}`);
    }
    conn[key] = v;
  }
  return conn;
}

/** True when every `requires` key for a connection has a stored value. */
export async function connectionConfigured(store: Pick<SecretStore, "get">, tool: string, label: string, requires: string[]): Promise<boolean> {
  for (const key of requires) if ((await store.get(connRef(tool, label, key))) === null) return false;
  return true;
}
