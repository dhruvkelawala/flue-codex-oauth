# Plan 004: Write user-facing docs and make the package publish-ready

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: verify plans 001, 002, and 003 are all marked
> DONE in `docs/plans/README.md`, and that `src/index.ts` exports `codexAuth`
> and `package.json` still has the `bin` entry `"flue-codex-login": "./dist/bin/login.js"`.
> If any of that is false, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: docs/plans/001-core-credential-store.md, 002-codex-auth-factory.md, 003-login-cli.md
- **Category**: docs
- **Planned at**: commit `94f94e7`, 2026-07-07

## Why this matters

Flue distributes third-party integrations two ways: an npm package the user
wires into `src/app.ts`, and a docs page a coding agent can apply via
`flue add <kind> <url>` (the CLI accepts an absolute URL as the agent's
research starting point). A README structured like Flue's own ecosystem pages
serves both at once. This plan also closes the publishing gaps: no LICENSE
file exists despite `"license": "MIT"`, and nothing verifies the npm tarball
actually contains what the `exports`/`bin` fields promise.

## Current state

- `README.md` is the scaffold-era stub: says "Status: skeleton — not yet
  implemented", shows the intended `codexAuth` usage, and lists three design
  principles (file-based store, peer-dep on `@flue/runtime`, options object).
  After plans 001–003 the "not yet implemented" line is false.
- `package.json` declares `"license": "MIT"` but the repo has no `LICENSE` file.
- `"files": ["dist"]` and `"exports": { ".": "./dist/index.js" }` and
  `"types": "./dist/index.d.ts"` exist but have never been validated against a
  packed tarball.
- No `prepublishOnly` guard: `npm publish` from a stale `dist/` would ship
  old code.

### Structure to imitate

Flue's ecosystem pages (e.g. the Daytona sandbox page, readable via
`flue docs read ecosystem/sandboxes/daytona` in any Flue project, or at
https://flueframework.com/docs) follow this section order — mirror it:

1. Title + one-line summary (blockquote)
2. **Quickstart** — the minimal install + wire-up
3. **Overview** — what the package does and does not own
4. **Configure** — tables: env/options with a Purpose column, marking
   **Required** items, plus a Requirements table (packages, ownership notes)
5. **Typical use** — a complete copy-pasteable example
6. Links out (Flue guide pages, upstream docs)

## Commands you will need

| Purpose        | Command                     | Expected on success |
|----------------|-----------------------------|---------------------|
| Build          | `pnpm build`                | exit 0              |
| Tests          | `pnpm test`                 | all pass            |
| Pack (dry-run) | `npm pack --dry-run --json` | JSON listing of tarball contents |

**Environment note**: use Node ≥ 20 and pnpm 10 via
`export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"` + `corepack pnpm <cmd>`.

## Scope

**In scope** (the only files you should create or modify):
- `README.md` (rewrite)
- `LICENSE` (create, MIT)
- `package.json` (add `prepublishOnly`, `repository`/`keywords` metadata)
- `docs/plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- Anything in `src/` or `tests/` — if docs writing reveals an API bug, STOP
  and report it instead of fixing it here.
- Publishing itself (`npm publish`) — never run it; that is the operator's call.

## Git workflow

- Work on `main`; conventional commits (e.g. `docs: rewrite README as ecosystem-style page`).
- Do NOT push.

## Steps

### Step 1: Create `LICENSE`

Standard MIT text, copyright line: `Copyright (c) 2026 Dhruv Kelawala`.

**Verify**: `test -f LICENSE && head -1 LICENSE` → `MIT License`.

### Step 2: Rewrite `README.md`

Follow the ecosystem-page structure above. Content requirements:

- **Quickstart**: `pnpm add flue-codex-oauth` (with `@flue/runtime` already
  present as the host app's dependency), then `npx flue-codex-login`, then the
  `src/app.ts` wiring:

  ```ts
  import { codexAuth } from "flue-codex-oauth";
  import { flue } from "@flue/runtime/routing";
  import { Hono } from "hono";

  const codex = codexAuth();            // defaults: ~/.flue/openai-codex.json
  await codex.configure();              // startup: refresh if stale + registerProvider

  const app = new Hono();
  app.use("*", codex.middleware());     // keep the token fresh per request
  app.route("/", flue());
  export default app;
  ```

  and pointing the agent at the provider: `model: "openai-codex/gpt-5.5"`.
  Verify this example compiles against the real API in `src/index.ts` before
  writing it down — adjust the README (not the code) if the API differs.
- **Overview**: what it owns (credential file lifecycle, refresh, provider
  registration) and what it does not (model selection, initial OAuth consent
  UX beyond the device-code prompt, Windows permission enforcement).
- **Configure**: one table for `CodexAuthOptions` (every option, its default,
  Purpose column), one row for `FLUE_CODEX_AUTH_PATH` (login CLI only), and a
  Requirements table: `@flue/runtime` ≥1.0.0-beta.9 (peer), Node ≥ 20,
  a ChatGPT/Codex subscription.
- **Security posture** section (this package's differentiator, keep from the
  old README and expand): auth file outside the repo with 0600 perms and
  atomic writes; env-var credential forms rejected by default (list the
  rejected names from `src/env-hygiene.ts`); tokens never logged.
- **`flue add` note**: users can hand this repo's URL to
  `flue add tooling <repo-url>` to have a coding agent apply the integration.
- No claims the code doesn't back. Every option named in the README must
  exist in `src/codex-auth.ts` — grep to confirm.

**Verify**:
`grep -c "Quickstart\|Overview\|Configure\|Typical use\|Security" README.md` → ≥ 5, and
for each option name in the README's Configure table:
`grep -n "<optionName>" src/codex-auth.ts` → match found.

### Step 3: Packaging guards in `package.json`

1. Add `"prepublishOnly": "pnpm typecheck && pnpm test && pnpm build"`.
2. Add `"repository"`, `"keywords"` (`["flue", "codex", "oauth", "openai", "agent"]`),
   and `"publishConfig": { "access": "public" }`.
3. Validate the tarball: run `npm pack --dry-run --json` and confirm the file
   list includes `dist/index.js`, `dist/index.d.ts`, `dist/bin/login.js`,
   `dist/credential-store.js`, `README.md`, `LICENSE`, `package.json` — and
   does NOT include `src/`, `tests/`, `docs/`, or any `.tmp`/auth-file paths.

**Verify**: `npm pack --dry-run --json | node -e "const l=JSON.parse(require('fs').readFileSync(0,'utf8'))[0].files.map(f=>f.path); for (const need of ['dist/index.js','dist/bin/login.js','LICENSE','README.md']) if (!l.includes(need)) { console.error('missing', need); process.exit(1) } for (const bad of l) if (bad.startsWith('src/')||bad.startsWith('docs/')||bad.startsWith('tests/')) { console.error('leaked', bad); process.exit(1) } console.log('pack ok')"` → `pack ok`.

## Test plan

No new unit tests. The verification gates above (README-to-code grep
consistency, tarball content check) are this plan's tests. Run the full
`pnpm test` once at the end to prove docs work broke nothing.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `LICENSE` exists, MIT
- [ ] `README.md` contains Quickstart / Overview / Configure / Typical use /
      Security sections and no "not yet implemented" text
      (`grep -c "not yet implemented" README.md` → 0)
- [ ] Every option documented in the README exists in `src/codex-auth.ts`
- [ ] `prepublishOnly` script present; `npm pack --dry-run` check passes
- [ ] `pnpm test` exits 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `docs/plans/README.md` status row for 004 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The implemented API in `src/index.ts` / `src/codex-auth.ts` differs from the
  Quickstart example in a way that makes the example wrong (e.g. `codexAuth()`
  requires an argument) — report the mismatch; do not change the code.
- `npm pack --dry-run` shows files leaking from outside `dist/` that the
  `files` field should exclude and editing `files` doesn't fix it.

## Maintenance notes

- When `@flue/runtime` leaves beta, update the peer range, the README
  Requirements table, and re-verify the Quickstart against the stable API.
- If the package is later published under an npm scope (e.g. `@dhruv/...`),
  the README install commands and the `bin` name mapping need a sweep.
- Deferred: a hosted docs page + registration in Flue's blueprint registry (if
  Flue opens third-party blueprint listings; today only the URL form of
  `flue add` works for external packages).
