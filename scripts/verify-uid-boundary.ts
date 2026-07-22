/**
 * Adversarial uid-boundary verification (manual acceptance test, Linux/Docker only).
 *
 * Proves — with real OS permissions, not mocks — that a runner subprocess dropped to a
 * low-privilege uid/gid CANNOT read the broker's secrets, while the broker (root in this
 * harness) can still `git add`/`commit`/`reset --hard`/`clean -fd` the files that runner
 * wrote into the shared-group vault working tree. This is the Task 5 proof for slice
 * 1B-1b: the runner→broker process boundary is a real trust boundary on a privileged
 * Linux host, not just in the SDK's own permission layer.
 *
 * Filesystem-deterministic — no API key, no LLM, no SDK. Must run as root (the broker),
 * which is why it targets a Docker container rather than a dev machine.
 *
 * Requires GEODE_RUNNER_UID and GEODE_RUNNER_GID (the low-privilege runner identity to
 * drop into — GEODE_RUNNER_GID must be the shared group, or the shared-group write model
 * this proves breaks). See .agent/SOP/verify-uid-boundary.md for the ownership model and
 * the `docker build` / `docker run` invocation.
 *
 * Run: `npx tsx scripts/verify-uid-boundary.ts` (as root, with both env vars set) or via
 * the provided Dockerfile: `docker build -t geode-uidcheck . && docker run --rm geode-uidcheck`.
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync, chownSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

/** Reads a required integer environment variable, exiting with a clear message if it is absent or not an integer. */
function requireEnvInt(name: string): number {
  const raw = process.env[name];
  if (!raw) {
    console.error(`Missing required env var: ${name} (see .agent/SOP/verify-uid-boundary.md)`);
    process.exit(1);
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    console.error(`${name}="${raw}" is not an integer`);
    process.exit(1);
  }
  return n;
}

/** Result of a single filesystem probe (a read or a write) attempted by the runner-uid child. */
interface ProbeOutcome {
  ok: boolean;
  code?: string;
  bytes?: number;
}

/** All probe results reported by one runner-uid child-process invocation, keyed by probe name. */
interface ProbeReport {
  secrets: ProbeOutcome;
  staging: ProbeOutcome;
  vaultTop: ProbeOutcome;
  vaultNested: ProbeOutcome;
}

/** One recorded pass/fail assertion, printed in the final report. */
interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

// Plain JS (no TS, no loader) run via `node -e` under the dropped uid/gid — deliberately
// trivial: three filesystem probes, self-reported as JSON on stdout. `process.umask(0o002)`
// mirrors the "broker (and the kernel it launches) run with umask 002" requirement so
// runner-created nested dirs stay group-writable, not just top-level ones.
const PROBE_SOURCE = `
const fs = require("node:fs");
const path = require("node:path");
process.umask(0o002);
const result = {};
function tryRead(key, file) {
  try {
    const data = fs.readFileSync(file, "utf8");
    result[key] = { ok: true, bytes: data.length };
  } catch (err) {
    result[key] = { ok: false, code: err && err.code ? err.code : String(err) };
  }
}
function tryWrite(key, file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "written-by-runner");
    result[key] = { ok: true };
  } catch (err) {
    result[key] = { ok: false, code: err && err.code ? err.code : String(err) };
  }
}
tryRead("secrets", process.env.SECRETS_FILE);
tryRead("staging", process.env.STAGING_FILE);
tryWrite("vaultTop", path.join(process.env.VAULT_DIR, process.env.TOP_FILE));
tryWrite("vaultNested", path.join(process.env.VAULT_DIR, process.env.NESTED_DIR, process.env.NESTED_FILE));
process.stdout.write(JSON.stringify(result));
`;

const RUNNER_UID = requireEnvInt("GEODE_RUNNER_UID");
const RUNNER_GID = requireEnvInt("GEODE_RUNNER_GID");

if (typeof process.getuid !== "function" || process.getuid() !== 0) {
  console.error("This harness must run as root (the broker) so it can drop the probe to RUNNER_UID/RUNNER_GID. Run it inside the provided Dockerfile.");
  process.exit(1);
}

/** Spawns the probe as the runner uid/gid with a minimal explicit env (never a copy of the broker's own env) and parses its JSON report. */
function runProbe(env: Record<string, string>): ProbeReport {
  const child = spawnSync(process.execPath, ["-e", PROBE_SOURCE], { uid: RUNNER_UID, gid: RUNNER_GID, env, encoding: "utf8" });
  if (child.error) throw new Error(`could not spawn probe under uid ${RUNNER_UID}/gid ${RUNNER_GID}: ${child.error.message}`);
  try {
    return JSON.parse(child.stdout.trim()) as ProbeReport;
  } catch {
    throw new Error(`probe produced non-JSON output (exit ${child.status}): stdout=${JSON.stringify(child.stdout)} stderr=${JSON.stringify(child.stderr)}`);
  }
}

const checks: Check[] = [];
/** Records one named pass/fail assertion for the final report. */
function check(name: string, pass: boolean, detail?: string): void {
  checks.push({ name, pass, detail });
}

// --- Broker provisioning: the ownership model from .agent/SOP/verify-uid-boundary.md ---

const workDir = mkdtempSync(join(tmpdir(), "geode-uidcheck-"));
chmodSync(workDir, 0o711); // mirrors ~/.geode: traversable by anyone, listable/writable only by the broker

const secretsDir = join(workDir, "secrets");
const vaultDir = join(workDir, "vault");
const stagingDir = join(workDir, "staging");
mkdirSync(secretsDir);
mkdirSync(vaultDir);
mkdirSync(stagingDir);

// secrets: broker-only, covers secrets.enc (and would cover key/sign/oauth/session/link in the real layout)
const secretsFile = join(secretsDir, "secrets.enc");
writeFileSync(secretsFile, "SENTINEL-DO-NOT-LEAK");
chmodSync(secretsDir, 0o700);

// vault working tree: shared-group, setgid, so the broker can reconcile runner-owned writes
chownSync(vaultDir, -1, RUNNER_GID);
chmodSync(vaultDir, 0o2770);
execFileSync("git", ["init", "-q"], { cwd: vaultDir });
execFileSync("git", ["config", "user.email", "broker@geode-uidcheck.local"], { cwd: vaultDir });
execFileSync("git", ["config", "user.name", "Geode Broker"], { cwd: vaultDir });
writeFileSync(join(vaultDir, "README.md"), "broker-authored — establishes an initial commit\n");
execFileSync("git", ["add", "-A"], { cwd: vaultDir });
execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: vaultDir });

// staging (uploads): group-readable by the runner, not broker-only
const stagingFile = join(stagingDir, "upload.txt");
writeFileSync(stagingFile, "staged-by-broker-for-runner");
chownSync(stagingDir, -1, RUNNER_GID);
chmodSync(stagingDir, 0o750);
chownSync(stagingFile, -1, RUNNER_GID);
chmodSync(stagingFile, 0o640);

// --- Adversarial probe #1: read secrets (expect EACCES), read staging + write vault (expect success) ---

const probeEnv = { PATH: process.env.PATH ?? "", SECRETS_FILE: secretsFile, STAGING_FILE: stagingFile, VAULT_DIR: vaultDir };
const first = runProbe({ ...probeEnv, TOP_FILE: "from-runner.txt", NESTED_DIR: "nested/sub", NESTED_FILE: "from-runner-nested.txt" });

check("runner denied read of secrets.enc with EACCES", first.secrets.ok === false && first.secrets.code === "EACCES", JSON.stringify(first.secrets));
check("runner can read the staged upload", first.staging.ok === true, JSON.stringify(first.staging));
check("runner can write a top-level vault file", first.vaultTop.ok === true, JSON.stringify(first.vaultTop));
check("runner can write a nested vault file", first.vaultNested.ok === true, JSON.stringify(first.vaultNested));

const nestedFile = join(vaultDir, "nested", "sub", "from-runner-nested.txt");
const nestedDir = join(vaultDir, "nested", "sub");
check("nested vault file exists on disk", existsSync(nestedFile), nestedFile);
if (existsSync(nestedFile)) {
  const st = statSync(nestedFile);
  check("nested vault file is owned by the runner uid", st.uid === RUNNER_UID, `uid=${st.uid}, expected ${RUNNER_UID}`);
}
if (existsSync(nestedDir)) {
  // A successful group-owned write alone does NOT prove setgid: an ordinary POSIX write
  // already inherits the process's own primary gid (which we set to RUNNER_GID on the
  // probe), so this would pass even with a plain 0770 (non-setgid) parent. The setgid bit
  // itself — which is what makes *broker*-created descendants and any group membership
  // beyond the probe's own gid inherit the shared group — has to be checked directly.
  const dirSt = statSync(nestedDir);
  check("runner-created nested dir inherited the setgid bit from the 2770 parent", (dirSt.mode & 0o2000) !== 0, `mode=${(dirSt.mode & 0o7777).toString(8)}`);
}

// --- Broker reconciliation #1: commit the runner's writes ---

let commitOk = false;
let commitErr = "";
try {
  execFileSync("git", ["add", "-A"], { cwd: vaultDir });
  execFileSync("git", ["commit", "-q", "-m", "runner write"], { cwd: vaultDir });
  commitOk = true;
} catch (err) {
  commitErr = String(err);
}
check("broker can git add+commit the runner-written files", commitOk, commitErr);

// --- Adversarial probe #2: an uncommitted nested write, to prove reset/clean also work ---

const second = runProbe({ ...probeEnv, TOP_FILE: "dirty-top.txt", NESTED_DIR: "dirty-nested/sub", NESTED_FILE: "dirty.txt" });
check("second runner write (uncommitted) succeeded", second.vaultNested.ok === true, JSON.stringify(second.vaultNested));

const dirtyNestedFile = join(vaultDir, "dirty-nested", "sub", "dirty.txt");
check("dirty nested file exists before reset/clean", existsSync(dirtyNestedFile), dirtyNestedFile);

// --- Broker reconciliation #2: reset --hard + clean -fd on runner-owned nested content ---

let resetOk = false;
let resetErr = "";
try {
  execFileSync("git", ["reset", "--hard"], { cwd: vaultDir });
  execFileSync("git", ["clean", "-fd"], { cwd: vaultDir });
  resetOk = true;
} catch (err) {
  resetErr = String(err);
}
check("broker can git reset --hard + clean -fd the runner-owned nested dir", resetOk, resetErr);
check("dirty nested file removed after clean -fd", !existsSync(dirtyNestedFile), dirtyNestedFile);
check("committed nested file survives reset (still present)", existsSync(nestedFile), nestedFile);

// --- Report ---

console.log("\n=== uid-boundary verification ===");
console.log(`runner uid=${RUNNER_UID} gid=${RUNNER_GID} | secretsDir=${secretsDir} | vaultDir=${vaultDir}`);
let allPass = true;
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"} — ${c.name}${c.pass ? "" : ` (${c.detail})`}`);
  if (!c.pass) allPass = false;
}
console.log(allPass ? "\nUID BOUNDARY HOLDS — runner cannot read secrets.enc; broker can still commit and reconcile runner writes." : "\nUID BOUNDARY FAILED — see above.");

rmSync(workDir, { recursive: true, force: true });
process.exit(allPass ? 0 : 1);
