# CLI argv tokenization — design

**Slice:** #3 follow-up (argv tokenization). The first item of the post-#2b resume agenda.

**Goal:** A `cli` tool action runs with a correct, injection-safe argument vector. Replace the whitespace-split (`command.split(/\s+/)`) that shatters any quoted/spaced command with a structural argv-array action form.

## The bug

`src/sandboxRun.ts:42` builds the container argv as:

```ts
const command = resolveTemplate(`${m.bin ? m.bin + " " : ""}${action.command}`, { params, conn });
docker.run(runArgs({ …, command: command.split(/\s+/), … }), …)
```

For cloakbrowser's `fetch`, `action.command` is a quoted Python one-liner:

```
python -c "from cloakbrowser import launch; b=launch(...); p.goto('<url>', ...); print(p.content()); b.close()"
```

`split(/\s+/)` turns the single `-c` script argument — which must be **one** argv element — into ~20 tokens (`["python", "-c", "\"from", "cloakbrowser", …]`). The action can never run. It is also an **argv-injection surface**: a `${params.url}` value containing whitespace silently injects extra container arguments.

`docker.run` is `spawn("docker", args)` (`src/docker.ts:47`) — execFile-style, **no shell** — and `runArgs` pushes `...command` literally after the image tag (`docker.ts:29`). So the array we build becomes the container's argv verbatim. A structural array therefore maps 1:1 onto the existing no-shell exec form.

## Decision: argv-array action form (array-only, no dual type)

`ToolAction.command` becomes `string[]` — a list where each element is exactly one argv token, template-resolved independently. The list boundary is *structural*, so a `${params.*}` value can never break out into additional tokens (the same property that makes `execFile(cmd, args[])` safe where `exec("cmd " + input)` is not). For a credentials-safety product this eliminates an injection class outright.

Rejected: keeping a string + adding a shell-aware tokenizer. It drags in shell semantics (the cloakbrowser script is full of `;` and `'`, which a real tokenizer treats as operators) and, because templates resolve *before* tokenization, it re-opens the same injection hole.

No backward-compatible `string | string[]` union — one form, one code path, "do it right, no tape."

### `bin` vs `command` — the principled boundary

- **`command: string[]`** (new) — per-action argv; the *only* field that interpolates untrusted `${params.*}`. Each element resolved with `resolveTemplate`, never split.
- **`bin?: string`** (unchanged type) — a static interpreter prefix shared across a tool's actions (`python`, or `node dist/cli.js`). It carries no interpolation, so it is whitespace-split — but **split first, then resolve each token**, so even a (hypothetical) interpolated bin token cannot fan out.

Final argv: `[...binTokens, ...commandElements]`.

## Components changed

### `src/tools.ts`
- `ToolAction.command?: string[]` (was `string`).
- `loadTool`: per-action structural validation. If `action.command` is present it must be a non-empty array of strings; reject the old string form with a clear, actionable message:
  > `tool <id>: action "<name>" — command must be a non-empty array of argv tokens (string[]); the space-separated string form was removed`

  This validates every tool type uniformly (http/mcp actions simply have no `command`).

### `src/sandboxRun.ts`
Replace lines 25 + 42's command construction with:

```ts
const ctx = { params, conn };
const binTokens = (m.bin ? m.bin.trim().split(/\s+/) : []).map((t) => resolveTemplate(t, ctx));
const argv = [...binTokens, ...action.command.map((t) => resolveTemplate(t, ctx))];
// runArgs({ …, command: argv, … })
```

`action.command` is guaranteed present + array by `loadTool` validation; the existing `if (!action?.command)` guard stays (defends against a manifest with an http/mcp action dispatched as cli).

### `kernel-skills/onboard-tool.md`
The worked `cli` example moves to the argv-array form so the agent authors the correct shape:

```yaml
bin: "node dist/cli.js"
actions:
  fetch:
    description: Fetch a URL, returning the page HTML.
    params: [{ name: url, required: true }]
    command: ["fetch", "--url", "${params.url}"]
```

Plus a one-line note: *command is an argv array — one token per element; never a single shell string. Put an interpolated value (`${params.url}`) in its own element.*

(The deeper "prefer a documented CLI subcommand over a guessed inline interpreter script" nudge is agenda **#3**, out of scope here. This slice only fixes the structural argv form.)

### Fixtures migrated to array form
- `test/invoke.test.ts` (`run`), `test/tools.test.ts` (`send`, `fetch`), `test/sandboxRun.test.ts` (`fetch`), `test/installer.test.ts` (`fetch`), `test/docker.test.ts` (manifest fixture), and `test/integration/fixture-tool/tools/echo-tool/TOOL.md` (3 actions).

## Testing

New tests (TDD — write first, watch fail, implement):

1. **No breakout (the core guarantee)** — `sandboxRun`: a param value with spaces and a quote (`url: "http://x/ a' b"`) lands as exactly **one** argv element. Assert via a stub `Docker` that captures `run`'s args; the resolved value appears as a single, unsplit token.
2. **Multiline `-c` script** — `bin: "python"`, `command: ["-c", "print('${params.x}')"]` → captured container argv is exactly `["python", "-c", "print('<x>')"]` (3 elements after the image tag).
3. **Multi-token `bin`** — `bin: "node dist/cli.js"`, `command: ["fetch"]` → argv prefix `["node", "dist/cli.js", "fetch"]`.
4. **loadTool rejects the old string form** — a manifest with `command: "fetch --url x"` throws the actionable message above.
5. **loadTool rejects an empty array** — `command: []` throws.

Existing `sandboxRun`/`invoke`/`installer`/`docker`/`tools` tests continue to pass once their fixtures are migrated.

## Out of scope
- The in-script interpolation risk (cloakbrowser interpolates a URL into Python *source*) — that is reduced by agenda **#3** (prefer a documented CLI command). This slice fixes only the structural argv bug.
- SHA-ref pinning (a separate #3 follow-up).
