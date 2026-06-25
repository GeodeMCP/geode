import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Interface for reading and writing named secrets in an encrypted store. */
export interface SecretStore {
  set(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  list(): Promise<string[]>;
  delete(ref: string): Promise<void>;
}

function enc(key: Buffer, plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}
function dec(key: Buffer, blob: Buffer): string {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), data = blob.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

/** Loads a 32-byte AES key from an env variable or a key file, creating the file if it does not yet exist. */
export function loadOrCreateKey(dir: string, envKey?: string): Buffer {
  if (envKey) {
    const b = Buffer.from(envKey, envKey.length === 64 ? "hex" : "base64");
    if (b.length !== 32) throw new Error("GEODE_SECRETS_KEY must be 32 bytes (hex or base64)");
    return b;
  }
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "key");
  if (existsSync(path)) return readFileSync(path);
  const k = randomBytes(32);
  writeFileSync(path, k, { mode: 0o600 });
  chmodSync(path, 0o600);
  return k;
}

/** Creates a SecretStore that encrypts all values with AES-256-GCM and persists them to a single file. */
export function createSecretStore(opts: { dir: string; key: Buffer }): SecretStore {
  mkdirSync(opts.dir, { recursive: true });
  const file = join(opts.dir, "secrets.enc");
  const read = (): Record<string, string> => (existsSync(file) ? JSON.parse(dec(opts.key, readFileSync(file))) : {});
  const write = (m: Record<string, string>) => writeFileSync(file, enc(opts.key, JSON.stringify(m)), { mode: 0o600 });
  return {
    async set(ref, value) { const m = read(); m[ref] = value; write(m); },
    async get(ref) { return read()[ref] ?? null; },
    async list() { return Object.keys(read()); },
    async delete(ref) { const m = read(); delete m[ref]; write(m); },
  };
}
