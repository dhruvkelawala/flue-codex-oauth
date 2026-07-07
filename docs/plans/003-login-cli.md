# Plan 003: Implement the `flue-codex-login` device-code login CLI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 94f94e7..HEAD -- src/bin/ src/login-support.ts tests/login-support.test.ts package.json`
> Plans 001–002 legitimately touched `src/` and `tests/`. Verify Plan 001 is
> DONE in `docs/plans/README.md` (this plan reuses its exports); if not, STOP.
> Plan 002 is NOT a dependency — this plan can run in parallel with it.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: docs/plans/001-core-credential-store.md
- **Category**: dx (extraction)
- **Planned at**: commit `94f94e7`, 2026-07-07

## Why this matters

Users need a one-time way to mint the auth file the package consumes:
`npx flue-codex-login` runs OpenAI's device-code flow and writes the
credentials with the same safety posture the runtime enforces (0600 mode,
atomic write, outside the project). Without it, users would hand-craft the
JSON — the exact failure mode this package exists to prevent.

## Current state

After Plan 001 the repo has `src/credential-store.ts` exporting
`writeAuthFileAtomic`, `expandHome`, and path helpers, and `package.json`
already declares the bin:

```json
// package.json (excerpt)
"bin": { "flue-codex-login": "./dist/bin/login.js" }
```

`tsconfig.json` has `"rootDir": "src"`, so `src/bin/login.ts` compiles to
`dist/bin/login.js` automatically.

### Reference implementation (read-only — do NOT modify it)

Reference: `/Users/dhruvkelawala/development/fluper-mario/.claude/worktrees/gifted-pasteur-a3a522`
(commit `057c5f1`; fall back to `/Users/dhruvkelawala/development/fluper-mario`),
file `scripts/login-openai-codex.mjs` (141 lines). Its flow:

1. Resolve the auth path: `--auth-path` flag → env var → project config →
   default (lines 15–19).
2. Expand `~`, require absolute (lines 30–35).
3. Refuse to write inside the project directory (lines 40–43).
4. Refuse to overwrite an existing file unless `--force` (lines 45–50).
5. `mkdir -p` the parent with mode 0700 + chmod 0700 (lines 52–54).
6. Run the device-code flow, printing the verification URI and user code
   (lines 56–61):

```js
const credentials = await loginOpenAICodexDeviceCode({
  onDeviceCode(info) {
    console.log(`Verification URI: ${info.verificationUri}`);
    console.log(`User code: ${info.userCode}`);
  },
});
```

7. Write `{ provider: "openai-codex", credentials, lastRefresh }` atomically
   with mode 0600 via temp-file + rename (lines 63–81).

### Decided design changes for the extraction (do not re-litigate)

1. **Path resolution order** becomes: `--auth-path` flag →
   `FLUE_CODEX_AUTH_PATH` env → default `~/.flue/openai-codex.json`.
   No config-file lookup (that was mario.config.json; hosts pass `--auth-path`).
   Note: the env var is a *path*, not credential material — it is deliberately
   NOT on the rejected-names list (`CODEX_AUTH_FILE` is rejected;
   `FLUE_CODEX_AUTH_PATH` is not, keep it that way).
2. **Reuse Plan 001's helpers**: `expandHome` and `writeAuthFileAtomic` come
   from `../credential-store.js` — do not duplicate the temp-file dance.
3. **TypeScript, compiled bin**: `src/bin/login.ts` with a `#!/usr/bin/env node`
   shebang on line 1 (tsc preserves it). npm sets the exec bit from the `bin`
   field on install; no chmod step needed in the build.
4. **Testable core**: pure logic (arg parsing, path resolution, guard
   decisions) lives in `src/login-support.ts`; `src/bin/login.ts` is a thin
   shell around it plus the network call.

## Commands you will need

| Purpose   | Command          | Expected on success |
|-----------|------------------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0              |
| Tests     | `pnpm test`      | all pass            |
| Build     | `pnpm build`     | exit 0              |

**Environment note**: use Node ≥ 20 and pnpm 10 via
`export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"` + `corepack pnpm <cmd>`.
Never run the real device-code flow in tests — it is an interactive network
call against OpenAI.

## Scope

**In scope** (the only files you should create or modify):
- `src/login-support.ts` (create)
- `src/bin/login.ts` (create)
- `src/index.ts` (optionally re-export login-support helpers; bin itself is not exported)
- `tests/login-support.test.ts` (create)
- `docs/plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `src/credential-store.ts`, `src/codex-auth.ts` — consumers only. If a change
  there seems required, STOP.
- `package.json` — the `bin` entry already exists and is correct.
- Anything under `/Users/dhruvkelawala/development/fluper-mario`.

## Git workflow

- Work on `main`; conventional commits (e.g. `feat(cli): add flue-codex-login bin`).
- Do NOT push.

## Steps

### Step 1: Create `src/login-support.ts`

```ts
export interface LoginPlan {
  authPath: string;      // absolute, ~-expanded
  force: boolean;
}

export interface LoginPlanError { error: string; }

export const DEFAULT_AUTH_PATH = "~/.flue/openai-codex.json";

/**
 * Pure decision function. `argv` excludes node/script. Guards, in order:
 * 1. resolve path: --auth-path → env.FLUE_CODEX_AUTH_PATH → DEFAULT_AUTH_PATH
 * 2. expandHome; must be absolute afterwards, else error
 * 3. must not be equal-to-or-inside cwd, else error naming the resolved path
 * 4. if file exists and !--force, error telling the user to re-run with --force
 */
export function planLogin(
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string,
  fileExists: (p: string) => boolean,
): LoginPlan | LoginPlanError;

export function usage(): string;   // help text, lists resolution order + flags
```

Reuse `expandHome` and the inside-path helper from `./credential-store.js`
(import; do not copy). Match the reference's guard messages closely, e.g.
`Refusing to write Codex auth inside the project directory: <path>` and
`Codex auth file already exists: <path>. Re-run with --force to overwrite.`
(reference lines 40–50).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Create `src/bin/login.ts`

Line 1 must be `#!/usr/bin/env node`. Behavior:

1. `--help`/`-h` → print `usage()`, exit 0.
2. `planLogin(process.argv.slice(2), process.env, process.cwd(), existsSync)`;
   on error print it to stderr plus usage, exit 1.
3. `mkdir` the parent recursively with mode 0700, then `chmod 0700` it
   (reference lines 52–54 — the chmod matters because `recursive: true`
   ignores `mode` for pre-existing dirs).
4. `const credentials = await loginOpenAICodexDeviceCode({ onDeviceCode(info) { ... } })`
   from `@earendil-works/pi-ai/oauth`, printing `Verification URI:` and
   `User code:` lines exactly as the reference does (lines 56–61).
5. `await writeAuthFileAtomic(authPath, { provider: "openai-codex", credentials, lastRefresh: new Date().toISOString() })`
   (from `../credential-store.js`), then print `Codex auth file written: <path>`.

**Verify**: `pnpm build` → exit 0, then
`head -c 21 dist/bin/login.js` → `#!/usr/bin/env node` and
`node dist/bin/login.js --help` → exits 0 printing the usage text (no network).

### Step 3: Tests — `tests/login-support.test.ts`

All against `planLogin` / `usage` (pure, no network, no fs writes):

1. Flag wins over env over default: three cases checking the resolved
   `authPath` (use a fake `fileExists` returning false and a tmp cwd).
2. `~/` expansion produces an absolute path under `homedir()`.
3. Relative `--auth-path ./x` → error mentioning "absolute".
4. Path inside `cwd` → the "inside the project directory" error.
5. Existing file without `--force` → the "already exists" error; with
   `--force` → a valid plan with `force: true`.
6. `usage()` mentions `--auth-path`, `--force`, `FLUE_CODEX_AUTH_PATH`, and
   the default path.

**Verify**: `pnpm test` → exit 0, all six cases passing.

## Test plan

Covered in Step 3. Pattern file: `tests/credential-store.test.ts`. The bin
shell itself gets only the `--help` smoke check from Step 2 — the device-code
network call is deliberately untested.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck`, `pnpm build`, `pnpm test` all exit 0
- [ ] `head -1 dist/bin/login.js` is `#!/usr/bin/env node`
- [ ] `node dist/bin/login.js --help` exits 0 and prints usage without any network access
- [ ] `grep -rn "loginOpenAICodexDeviceCode" src/` matches only `src/bin/login.ts`
- [ ] `grep -rn "mario\|FLUPER_" src/` returns no matches
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `docs/plans/README.md` status row for 003 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `@earendil-works/pi-ai/oauth` does not export `loginOpenAICodexDeviceCode`,
  or its callback shape differs from `onDeviceCode(info: { verificationUri, userCode })`
  (verify against `node_modules/@earendil-works/pi-ai` typings; the reference
  uses it at `scripts/login-openai-codex.mjs:56-61`).
- Plan 001's `writeAuthFileAtomic` or `expandHome` exports are missing.
- tsc does not preserve the shebang (check `dist/bin/login.js` after build) —
  report rather than adding a post-build script.

## Maintenance notes

- The printed `Verification URI:` / `User code:` lines are the whole UX of
  this command; if pi-ai adds richer device-code info, surface it here.
- If a future plan adds Windows support beyond "mode checks are skipped",
  the 0700 parent-dir handling in Step 2.3 needs a win32 branch.
- Deferred: a `--status` subcommand printing `readAuthStatus` output
  (trivial addition once someone asks for it).
