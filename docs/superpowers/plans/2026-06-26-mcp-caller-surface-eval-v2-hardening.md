# Caller-surface eval — v2 hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make the eval stress the axes trace-based scoring *can* measure, so the full-matrix verdict is meaningful: (1) nudge value via **ambiguous** discovery prompts, (2) cost via a **`turns`/`toolResultChars`** metric, (3) tiered-vs-flat legibility via a **scaled** fixture (more files + tools). LLM answer-quality judge stays OUT of scope.

**Why:** the v1 sanity run showed all configs discover easily (prompts were on-topic) and query-only retrieved fine (tiny vault), so the only measured leading-edge was `qry/leg`. The product hypothesis (nudge → unprompted discovery; tiered list → weak-model legibility; cheap reads → lower cost) lives on axes the v1 fixture didn't stress.

**Context:** builds on the committed v1 harness in `evals/`. Branch `feat/caller-surface-eval`.

---

## Task V1: `turns` + `toolResultChars` metrics (TDD)

**Files:** Modify `evals/types.ts`, `evals/caller.ts`, `evals/scorer.ts`, `evals/run.ts`; update `test/evals/caller.test.ts`, `test/evals/scorer.test.ts`.

- [ ] **Step 1: Extend types**

In `evals/types.ts`, add to `LegResult`: `turns: number;` (so it becomes `{ trace: Trace; finalText: string; turns: number }`).
In `LegMetrics`, add two fields after `heavyQueryCalls`:
```ts
  turns: number;
  toolResultChars: number;
```

- [ ] **Step 2: Caller counts model round-trips (update test first)**

In `test/evals/caller.test.ts`, add to the first test (`executes tool calls…`) after the existing asserts:
```ts
    expect(res.turns).toBe(2);
```
and to the `maxTurns` test:
```ts
    expect(res.turns).toBe(3);
```
Run `npx vitest run test/evals/caller.test.ts` → expect FAIL (`turns` undefined).

In `evals/caller.ts`: add `let turns = 0;` before the loop; increment `turns++;` immediately after `const { text, toolCalls } = await opts.model(...)`; change the return to `return { trace, finalText, turns };`.
Run `npx vitest run test/evals/caller.test.ts` → expect PASS.

- [ ] **Step 3: Scorer computes the two cost metrics (update test first)**

`scoreLeg` gains a 4th param `turns`. In `test/evals/scorer.test.ts`:
- Update EVERY `scoreLeg(trace, expect, cls)` call to `scoreLeg(trace, expect, cls, 2)` (pass any turns value, e.g. 2; for the empty-trace negative test pass `1`).
- In the `aggregate` test, add `turns: 2, toolResultChars: 10` to each row's `m` object.
- Add a new case in `describe("scoreLeg", …)`:
```ts
  it("reports turns and sums tool-result chars", () => {
    const trace: Trace = [call("search", { query: "x" }, "abcde"), call("read", { path: "y" }, "fghij")];
    const m = scoreLeg(trace, { discovers: true }, "should-use", 3);
    expect(m.turns).toBe(3);
    expect(m.toolResultChars).toBe(10);
  });
```
Run `npx vitest run test/evals/scorer.test.ts` → expect FAIL.

In `evals/scorer.ts`:
- Change signature to `export function scoreLeg(trace: Trace, expect: Expect, cls: ScenarioClass, turns: number): LegMetrics`.
- Compute `const toolResultChars = trace.reduce((s, c) => s + c.result.length, 0);`.
- Add `turns, toolResultChars` to the returned object.
- In `ConfigScore`, add `avgTurns: number; avgToolResultChars: number;`.
- In `aggregate`, add to each group's object:
```ts
    avgTurns: g.reduce((s, r) => s + r.m.turns, 0) / g.length,
    avgToolResultChars: g.reduce((s, r) => s + r.m.toolResultChars, 0) / g.length,
```
Run `npx vitest run test/evals/scorer.test.ts` → expect PASS.

- [ ] **Step 4: Runner threads turns + prints new columns**

In `evals/run.ts`:
- In `runScenario`, change `const { trace } = await runCaller(...)` to `const { trace, turns } = await runCaller(...)` and `scoreLeg(trace, leg.expect, sc.cls)` to `scoreLeg(trace, leg.expect, sc.cls, turns)`.
- Extend the scorecard header + row format to add two columns after `qry/leg`: `turns` and `chars` (rounded `avgTurns` to 1 decimal and `avgToolResultChars` to integer). Keep alignment reasonable; example row format:
```ts
  console.log(`${s.config.padEnd(20)} ${s.tier.padEnd(6)} ${pct(s.discovered)} ${pct(s.correctRetrieval)} ${pct(s.correctInvoke)} ${pct(s.falseTrigger)} ${pct(s.remembered)}  ${s.avgHeavyQueryCalls.toFixed(1)}   ${s.avgTurns.toFixed(1)}  ${Math.round(s.avgToolResultChars).toString().padStart(5)}  ${s.n}`);
```
and update the header line to include `qry/leg turns  chars  n`.

- [ ] **Step 5: Full sweep + commit**

Run `npm test` → all green. Run `GEODE_EVAL_DRY=1 GEODE_EVAL_TIERS=weak GEODE_EVAL_REPEATS=1 GEODE_EVAL_CONFIGS=leading npm run eval` → exit 0, scorecard now shows `turns`/`chars` columns.
```
git add -A
git commit -m "feat(evals): turns + tool-result-chars cost metrics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task V2: Ambiguous scenarios + scaled fixture

**Files:** Modify `evals/scenarios.ts`; add files under `evals/fixtures/vault/`; update `test/evals/capabilities.test.ts`.

- [ ] **Step 1: Add ambiguous should-use scenarios**

Append to `SCENARIOS` in `evals/scenarios.ts` (these name NO tool/vault — they test whether the caller reaches in unprompted; each maps to existing ground-truth content):
```ts
  {
    id: "ambiguous-followup", cls: "should-use",
    legs: [{ prompt: "Draft a short follow-up message to a new lead about our product.", expect: { discovers: true, readsFile: "warm, concise" } }],
  },
  {
    id: "ambiguous-lint", cls: "should-use",
    legs: [{ prompt: "Set up the linting config for this project the way it should be.", expect: { discovers: true, readsFile: "airbnb" } }],
  },
  {
    id: "ambiguous-ship", cls: "should-use",
    legs: [{ prompt: "What's the command to ship the test environment?", expect: { discovers: true, readsFile: "acme-staging" } }],
  },
```
(`readsFile: "warm, concise"` matches the tone-of-voice file body `warm, concise`. The other needles already exist in fixture files.)

- [ ] **Step 2: Scale the fixture — distractor files**

Create ~12 distractor markdown files under new/existing folders (e.g. `evals/fixtures/vault/notes/`, `projects/`, `clients/`). Constraints:
- They add keyword NOISE on `deploy`, `staging`, `email`, `client`, `lint`, `lead`, `tone` so naive `search`/`query` return multiple hits.
- They must NOT contain any existing scenario needle string: `acme-staging`, `airbnb`, `warm, concise`, `companyB`/`company b`, `acme-sales`. Use OTHER project/company names (e.g. `blorp`, `zenith`, `northwind`) and different specifics.
- Each has YAML frontmatter (`type`, `title`) + a short body, matching the existing fixture style.
Also append their one-line summaries to `evals/fixtures/vault/index.md` so the index reflects them.

- [ ] **Step 3: Scale the fixture — more tools**

Add ~5 more tool manifests under `evals/fixtures/vault/tools/<id>/manifest.json` following the EXACT existing schema (`id, name, type, description, connections[], actions{}`), varying executor types across `http`/`cli`/`mcp`, each with 1–3 actions. Suggested ids: `slack` (http), `notion` (http), `calendar` (cli), `drive` (mcp), `stripe` (http). They are distractors — do NOT give any of them a `send`-email action (gmail must stay the unique email tool) and do NOT use the gmail connection labels.

- [ ] **Step 4: Update the capabilities test for the larger tool set**

In `test/evals/capabilities.test.ts`, the `loadManifests` test currently asserts exact equality to the 4 original ids. Change it to assert the original four are a SUBSET (robust to added tools):
```ts
  it("loads all tool manifests including the originals", () => {
    const ids = loadManifests(ROOT).map((m) => m.id);
    for (const id of ["cloakbrowser", "github", "gmail", "linear"]) expect(ids).toContain(id);
    expect(ids.length).toBeGreaterThanOrEqual(8);
  });
```
Leave the other capabilities assertions as-is (they still hold).

- [ ] **Step 5: Verify + commit**

Run `npm test` → all green (existing scenarios still resolve; capabilities test updated). Verify manifests parse:
`node -e "require('fs').readdirSync('evals/fixtures/vault/tools').forEach(t=>JSON.parse(require('fs').readFileSync('evals/fixtures/vault/tools/'+t+'/manifest.json','utf8')))" && echo JSON_OK`
```
git add -A
git commit -m "test(evals): ambiguous discovery scenarios + scaled fixture (distractors + tools)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task V3: Full matrix run (controller-run, not a subagent)

- [ ] Run the full matrix (controller does this directly, needs the API key from the main repo `.env`):
```
GEODE_EVAL_TIERS=strong,weak GEODE_EVAL_REPEATS=3 \
  npx tsx --env-file=/Users/robbertvermeulen/Projects/geodemcp-2/.env evals/run.ts
```
(all 5 configs, both tiers, 3 repeats). Capture the scorecard, interpret per the three axes, report to the user.
