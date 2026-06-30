import { spawn } from "node:child_process";
import type { ToolManifest } from "./tools.js";

/** The cached image tag for a tool, keyed by id + pinned ref. */
export function imageTag(m: ToolManifest): string { return `geode-tool/${m.id}:${m.source?.ref ?? "latest"}`; }

/** Generates the Dockerfile that clones the pinned source and bakes the install — no secrets ever. */
export function buildDockerfile(m: ToolManifest): string {
  const base = m.image?.base ?? "node:20-slim";
  const lines = [`FROM ${base}`, "WORKDIR /tool"];
  if (m.source?.repo) {
    const ref = m.source.ref ? ` --branch ${m.source.ref}` : "";
    lines.push(`RUN git clone --depth 1${ref} ${m.source.repo} .`);
  } else if (m.source?.package) {
    lines.push(`RUN ${m.source.package.startsWith("pip:") ? `pip install ${m.source.package.slice(4)}` : `npm install -g ${m.source.package.replace(/^npm:/, "")}`}`);
  }
  for (const cmd of m.install ?? []) lines.push(`RUN ${cmd}`);
  return lines.join("\n") + "\n";
}

/** Options for a single sandboxed run. */
export interface RunOpts { name: string; tag: string; command: string[]; envFile: string; network: "none" | "bridge"; memoryMb?: number; cpus?: number; timeoutMs?: number }

/** Builds the locked-down `docker run` argv (named container, read-only rootfs, no mounts, env-file creds, hardening, limits). */
export function runArgs(o: RunOpts): string[] {
  const a = ["run", "--name", o.name, "--rm", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--network", o.network, "--env-file", o.envFile];
  if (o.memoryMb) a.push("--memory", `${o.memoryMb}m`);
  if (o.cpus) a.push("--cpus", String(o.cpus));
  a.push(o.tag, ...o.command);
  return a;
}

/** Result of a finished container run. `timedOut` is set when the run was killed for exceeding its timeout. */
export interface RunResult { exitCode: number; stdout: string; stderr: string; timedOut?: boolean }

/** Injectable Docker side-effects (stubbed in unit tests, real in integration). */
export interface Docker {
  available(): Promise<boolean>;
  imageExists(tag: string): Promise<boolean>;
  build(tag: string, dockerfile: string): Promise<void>;
  run(args: string[], opts?: { timeoutMs?: number; killName?: string }): Promise<RunResult>;
  removeImage(tag: string): Promise<void>;
}

const sh = (cmd: string, args: string[], input?: string, timeoutMs?: number, killName?: string): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
      // Killing the attached `docker run` client does NOT stop the container in the daemon,
      // so best-effort kill + remove the container by name (fire-and-forget, ignore errors).
      if (killName) {
        try { spawn("docker", ["kill", killName]).on("error", () => {}); } catch { /* ignore */ }
        try { spawn("docker", ["rm", "-f", killName]).on("error", () => {}); } catch { /* ignore */ }
      }
      resolve({ exitCode: 124, stdout, stderr, timedOut: true });
    }, timeoutMs) : null;
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => { if (timedOut) return; reject(e); });
    p.on("close", (code) => { if (timedOut) return; if (timer) clearTimeout(timer); resolve({ exitCode: code ?? -1, stdout, stderr }); });
    if (input !== undefined) { p.stdin.write(input); p.stdin.end(); }
  });

/** The real Docker wrapper, spawning the `docker` CLI. */
export function realDocker(): Docker {
  return {
    async available() { try { return (await sh("docker", ["version", "--format", "{{.Server.Version}}"])).exitCode === 0; } catch { return false; } },
    async imageExists(tag) { return (await sh("docker", ["image", "inspect", tag])).exitCode === 0; },
    async build(tag, dockerfile) { const r = await sh("docker", ["build", "-t", tag, "-f", "-", "."], dockerfile); if (r.exitCode !== 0) throw new Error(`docker build failed: ${r.stderr.slice(-800)}`); },
    async run(args, opts) { return sh("docker", args, undefined, opts?.timeoutMs, opts?.killName); },
    async removeImage(tag) { await sh("docker", ["rmi", "-f", tag]); },
  };
}
