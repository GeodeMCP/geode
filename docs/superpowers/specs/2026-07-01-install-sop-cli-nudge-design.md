# #3 — Install-SOP nudge: prefer a documented CLI over an inline interpreter script

**Slice:** Resume-agenda item 3. Doc-only change to the kernel-default onboarding skill (`kernel-skills/onboard-tool.md`). User-overridable via the `skills/` overlay.

**Goal:** Steer the onboarding agent to make a tool's action `command` a **documented CLI subcommand** when one exists, rather than a hand-written inline interpreter script (`python -c "…"` / `node -e "…"`). The live cloakbrowser onboarding produced a Playwright-shaped inline `python -c "from cloakbrowser import launch; …"` `fetch` — a guess about the library API. This nudge reduces that.

**Why it matters:**
- An inline interpreter script is a *guess* about the library's API — brittle across versions, and often wrong.
- It interpolates `${params.*}` into **source code** (a wider injection surface) instead of passing them as discrete argv tokens — even with the #1 argv-array form, the value still lands inside a code string.
- A documented CLI subcommand is stable, tested by the upstream project, and takes structured flags.

**Scope:** Only `kernel-skills/onboard-tool.md`. No code, no schema, no tests (the skill body is guidance prose; the resolver mechanism in `src/skills.ts` is unaffected and already tested). The `command`-is-an-argv-array note (added in #1) stays; this adds the *prefer-documented-CLI* guidance on top.

## Change

1. Expand the `actions` bullet under "Derive by inspection" with a sub-point:
   > **Prefer the tool's documented CLI subcommand** over a hand-written inline interpreter script. If the README / `--help` shows a command for the operation (`tool fetch --url …`), make that the action `command`. Fall back to an inline `python -c "…"` / `node -e "…"` only when the tool exposes no CLI for it — and say so as an assumption in your report. An inline script is a *guess* about the library's API: brittle across versions, and it interpolates `${params.*}` into source code (a wider injection surface) rather than passing them as discrete argv tokens.

2. Add an **Avoid** line right after the worked example, naming the concrete anti-pattern:
   > **Avoid** authoring an action as an inline interpreter script when a CLI exists — prefer `command: ["fetch", "--url", "${params.url}"]` over `command: ["-c", "from cloakbrowser import launch; launch().goto('${params.url}') …"]`. The latter guesses the library API and interpolates an untrusted value into source.

## Verification
- The running kernel reads this SOP file at onboarding time (`buildSkillsFooter` → `resolveSkill` reads `<repo>/kernel-skills/onboard-tool.md` per query), so once merged + the main repo fast-forwarded, a fresh `onboard` query uses the new guidance — no restart needed.
- Manual: re-onboard cloakbrowser; confirm the agent prefers a documented CLI subcommand (or explicitly states the assumption when falling back to an inline script), and emits argv-array `command`s.
