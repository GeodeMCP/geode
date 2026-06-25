import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The public identity of an authenticated account, safe to pass to callers without exposing credentials. */
export interface Principal { id: string; email: string; createdAt: number }
interface OwnerRecord { id: string; email: string; salt: string; hash: string; createdAt: number }

/** Store interface for managing the single machine-local owner account. */
export interface AccountStore {
  hasOwner(): boolean;
  getOwner(): Principal | null;
  createOwner(args: { email: string; password: string }): Principal;
  verify(email: string, password: string): Principal | null;
  setPassword(email: string, password: string): void;
}

const MIN_PASSWORD = 10;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const normEmail = (e: string) => e.trim().toLowerCase();
const hashPw = (password: string, salt: Buffer): Buffer => scryptSync(password, salt, 32);

// Single-owner account, machine-local (one record). The interface is deliberately store-shaped so a
// future multi-account/DB implementation drops in without changing callers.
/** Creates a file-backed account store that persists one owner record in the given directory using scrypt password hashing. */
export function createAccountStore(dir: string): AccountStore {
  const file = join(dir, "account.json");
  const read = (): OwnerRecord | null => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as OwnerRecord) : null);
  const write = (rec: OwnerRecord) => { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(rec, null, 2), { mode: 0o600 }); };
  const toPrincipal = (r: OwnerRecord): Principal => ({ id: r.id, email: r.email, createdAt: r.createdAt });
  const recordFor = (email: string, password: string, base?: OwnerRecord): OwnerRecord => {
    if (password.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
    const salt = randomBytes(16);
    return { id: base?.id ?? randomUUID(), email, salt: salt.toString("hex"), hash: hashPw(password, salt).toString("hex"), createdAt: base?.createdAt ?? Date.now() };
  };
  return {
    hasOwner: () => read() !== null,
    getOwner: () => { const r = read(); return r ? toPrincipal(r) : null; },
    createOwner({ email, password }) {
      if (read()) throw new Error("owner already exists");
      const norm = normEmail(email);
      if (!EMAIL_RE.test(norm)) throw new Error("invalid email");
      const rec = recordFor(norm, password);
      write(rec);
      return toPrincipal(rec);
    },
    verify(email, password) {
      const r = read();
      if (!r || r.email !== normEmail(email)) return null;
      const expected = Buffer.from(r.hash, "hex");
      const got = hashPw(password, Buffer.from(r.salt, "hex"));
      return got.length === expected.length && timingSafeEqual(got, expected) ? toPrincipal(r) : null;
    },
    setPassword(email, password) {
      const r = read();
      if (!r || r.email !== normEmail(email)) throw new Error("no such owner");
      write(recordFor(email, password, r));
    },
  };
}
