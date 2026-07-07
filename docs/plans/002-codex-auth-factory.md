# Plan 002: Implement the `codexAuth()` factory — provider registration, middleware, env hygiene

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 94f94e7..HEAD -- src/index.ts src/codex-auth.ts src/env-hygiene.ts tests/`
> Plan 001 legitimately created `src/index.ts`, `src/credential-store.ts`, and
> `tests/credential-store.test.ts` — those diffs are expected. Verify Plan 001
> is marked DONE in `docs/plans/README.md`; if not, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches the host-app integration contract)
- **Depends on**: docs/plans/001-core-credential-store.md
- **Category**: tech-debt (extraction)
- **Planned at**: commit `94f94e7`, 2026-07-07

## Why this matters

This is the package's public API — the one-liner a Flue user adds to
`src/app.ts` to get Codex subscription auth. It ties the Plan-001 credential
store to Flue's `registerProvider()` and gives the host app a Hono middleware
that keeps the registered token fresh across requests. Get the module topology
wrong (calling a bundled copy of `registerProvider` instead of the host's) and
the package silently does nothing, so the peer-dependency wiring here is the
riskiest and most valuable part.

## Current state

After Plan 001, the target repo has `src/credential-store.ts` exporting
`resolveApiKey(options)`, `validateAuthPath`, `readAuthStatus`, `expandHome`,
and the `CodexCredentialStoreOptions` / `AuthCheck` types. `src/index.ts`
re-exports them. `@flue/runtime` is a **peer dependency** (also in
devDependencies at `1.0.0-beta.9` so tests can import it); `hono` is an
**optional** peer.

### Reference implementation (read-only — do NOT modify it)

Reference codebase: `/Users/dhruvkelawala/development/fluper-mario/.claude/worktrees/gifted-pasteur-a3a522`
(commit `057c5f1`; fall back to `/Users/dhruvkelawala/development/fluper-mario`).
Relevant files:

- `src/runtime/model-auth.ts` (300 lines) — provider registration + env
  hygiene checks.
- `src/runtime/credentials.ts` (7 lines) — placeholder detector.
- `src/app.ts` (31 lines) — how the host app consumes it.

The registration core (`model-auth.ts` lines 124–137):

```ts
export async function configureModelAuthProvider(options: ModelAuthResolveOptions = {}) {
  const resolution = resolveModelAuth(options);
  if (resolution.strategy === CODEX_SUBSCRIPTION_STRATEGY) {
    const localOptions = buildLocalCodexAuthOptions(options, resolution.localCodexSubscription?.authPath);
    const { apiKey } = await resolveCodexSubscriptionApiKey(localOptions);
    registerProvider(CODEX_PROVIDER_ID, { apiKey });   // CODEX_PROVIDER_ID = "openai-codex"
  }
  return resolution;
}
```

The host-app wiring pattern (`app.ts` lines 13–21) — configure once at startup,
then re-configure per request via Hono middleware so tokens refresh mid-flight:

```ts
await configureModelAuthProvider();
// ...
const app = new Hono();
app.use("*", async (_c, next) => {
  await configureModelAuthProvider();
  await next();
});
```

Env names that must never carry real Codex OAuth material
(`model-auth.ts` lines 24–34):

```ts
const CODEX_AUTH_ENV_NAMES = [
  "OPENAI_CODEX_AUTH_JSON", "OPENAI_CODEX_AUTH_FILE", "OPENAI_CODEX_ACCESS_TOKEN",
  "OPENAI_CODEX_REFRESH_TOKEN", "OPENAI_CODEX_ID_TOKEN",
  "CODEX_AUTH_JSON", "CODEX_AUTH_FILE", "CODEX_ACCESS_TOKEN", "CODEX_REFRESH_TOKEN",
] as const;
```

The placeholder detector (`credentials.ts`, entire file):

```ts
export function isPlaceholderCredential(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^PH_[A-Za-z0-9._:-]+$/.test(trimmed) || /placeholder/i.test(trimmed);
}
```

### Decided design changes for the extraction (do not re-litigate)

1. **No mario-config, no `FLUPER_*` env resolution.** The factory takes a
   plain options object. Hosts read their own config.
2. **No model-selection logic.** The reference decides "is codex requested?"
   from the model specifier (`model-auth.ts` lines 66–76). This package
   assumes the caller wants Codex auth — that is why they installed it. The
   factory always registers `openai-codex`.
3. **No version pinning.** Drop `verifyFlueProviderSurface`'s exact-version
   checks (`model-auth.ts` lines 52–60) and its `pi-ai/compat` catalog probes.
   The peer range in `package.json` is the version contract. Keep only a
   runtime guard: if the injected/imported `registerProvider` is not a
   function, throw a clear error.
4. **`registerProvider` comes from the host's `@flue/runtime`.** Import it
   normally (`import { registerProvider } from "@flue/runtime"`) — as a peer
   dependency this resolves to the host's copy. Also accept an injected
   override in options for tests.
5. **Env hygiene**: keep the `CODEX_AUTH_ENV_NAMES` rejection (error) as a
   default-on check. **Divergence from the reference**: do NOT reject
   `OPENAI_API_KEY` — a generic host may legitimately use the plain `openai`
   provider alongside Codex. Drop the sandbox-env-names check too (that is a
   fluper-mario concept); hosts with sandboxes can pass extra names via
   `rejectedEnvNames`.
6. **Single-flight refresh** (new, not in the reference): concurrent
   middleware invocations must share one in-flight `configure()` promise
   rather than racing multiple token refreshes.
7. **Hono decoupling**: `middleware()` must not require `hono` at runtime.
   Type it structurally (`(c: unknown, next: () => Promise<void>) => Promise<void>`)
   so it satisfies Hono's `MiddlewareHandler` without importing it. Do not
   import `hono` in `src/` at all; the optional peer exists only for
   documentation and downstream typing.

## Commands you will need

| Purpose   | Command          | Expected on success |
|-----------|------------------|---------------------|
| Install   | `pnpm install`   | exit 0              |
| Typecheck | `pnpm typecheck` | exit 0              |
| Tests     | `pnpm test`      | all pass            |
| Build     | `pnpm build`     | exit 0              |

**Environment note**: use Node ≥ 20 and pnpm 10 via
`export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"` + `corepack pnpm <cmd>`.

## Scope

**In scope** (the only files you should create or modify):
- `src/codex-auth.ts` (create — the factory)
- `src/env-hygiene.ts` (create)
- `src/index.ts` (add re-exports)
- `tests/codex-auth.test.ts` (create)
- `tests/env-hygiene.test.ts` (create)
- `docs/plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `src/credential-store.ts` — if it needs changes to support this plan, STOP.
- Anything under `/Users/dhruvkelawala/development/fluper-mario`.
- `README.md`, bin/CLI files, `package.json` (peer deps are already correct).

## Git workflow

- Work on `main`; one conventional commit per step
  (e.g. `feat(factory): add codexAuth() with provider registration`).
- Do NOT push.

## Steps

### Step 1: Create `src/env-hygiene.ts`

Port `CODEX_AUTH_ENV_NAMES` and `isPlaceholderCredential` (excerpts above),
plus one function:

```ts
export function checkEnvHygiene(
  env: Record<string, string | undefined>,
  extraRejectedNames: string[] = [],
): AuthCheck[];
```

Returns a single check named `codex-no-env-credentials` that fails (severity
`error`) when any of the names (built-in list + extras) holds a non-empty,
non-placeholder value. The message must list the offending *names* only —
never the values.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Create `src/codex-auth.ts`

Public surface:

```ts
import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import type { AuthCheck, CodexAuthStatus } from "./credential-store.js";

export interface CodexAuthOptions {
  /** Auth file path; "~/" is expanded. Default: "~/.flue/openai-codex.json". */
  authPath?: string;
  /** Paths the auth file must not live inside. Default: [process.cwd()]. */
  forbiddenPaths?: string[];
  /** Refresh this long before expiry. Default: 300_000. */
  refreshSkewMs?: number;
  /** Extra env names to reject alongside the built-in Codex list. */
  rejectedEnvNames?: string[];
  /** Set false to skip env hygiene checks entirely. Default: true. */
  envHygiene?: boolean;
  /** Test seams. */
  env?: Record<string, string | undefined>;
  now?: () => number;
  refreshToken?: (refresh: string) => Promise<OAuthCredentials>;
  registerProvider?: (providerId: string, registration: { apiKey: string }) => void;
}

export interface CodexAuth {
  /** Resolve (refreshing if stale) and registerProvider("openai-codex", { apiKey }). */
  configure(): Promise<CodexAuthStatus>;
  /** Hono-compatible middleware: configure() then next(). Single-flight. */
  middleware(): (c: unknown, next: () => Promise<void>) => Promise<void>;
  /** Non-throwing snapshot of the auth file state. */
  status(): CodexAuthStatus;
  /** All validation checks (path safety + env hygiene) without side effects. */
  checks(): AuthCheck[];
}

export function codexAuth(options?: CodexAuthOptions): CodexAuth;
```

Behavior requirements:

- `configure()`:
  1. Run `checks()`; if any `error`-severity check fails, throw one `Error`
     listing every failing check (mirror the reference's aggregate format at
     `codex-subscription-auth.ts` lines 139–148:
     `"Codex subscription auth is not safe to use:\n- <name>: <message>"`).
  2. Call `resolveApiKey(...)` from `./credential-store.js`.
  3. Resolve the register function: `options.registerProvider ?? registerProvider`
     (imported from `@flue/runtime`). If it is not a function, throw
     `"@flue/runtime registerProvider is unavailable — is @flue/runtime installed as a peer?"`.
  4. `register("openai-codex", { apiKey })`, return the status.
- **Single-flight**: while a `configure()` promise is in flight, subsequent
  `configure()`/middleware calls await the same promise instead of starting a
  new resolve/refresh. Clear the slot when it settles (success or failure).
- `middleware()` returns `async (_c, next) => { await this.configure(); await next(); }`
  (with the single-flight sharing above).
- Default `authPath`: `expandHome("~/.flue/openai-codex.json")`.
- Import `registerProvider` from `@flue/runtime` at module top level. Type-only
  imports from `@flue/runtime` are fine; do NOT import from
  `@earendil-works/pi-ai/compat` or from `hono`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Wire exports

Add to `src/index.ts`: `codexAuth`, `CodexAuthOptions`, `CodexAuth`,
`checkEnvHygiene`, `CODEX_AUTH_ENV_NAMES`, `isPlaceholderCredential`.

**Verify**: `pnpm build` → exit 0; `node -e "import('./dist/index.js').then(m => { if (typeof m.codexAuth !== 'function') throw new Error('missing codexAuth'); console.log('ok'); })"` → prints `ok`.

### Step 4: Tests

`tests/env-hygiene.test.ts`:
1. Real-looking value in `CODEX_ACCESS_TOKEN` → failing check; the check's
   message contains the name, and `JSON.stringify` of the checks does not
   contain the value (mirror reference test `model-auth.test.ts` lines 107–136).
2. Placeholder values (`PH_TOKEN`, `"placeholder"`) pass.
3. `extraRejectedNames` are enforced.

`tests/codex-auth.test.ts` (use `mkdtempSync` temp dirs and the
`writeAuthFile` helper pattern from `tests/credential-store.test.ts`):
1. **Registration happy path**: valid unexpired auth file, injected
   `registerProvider` spy → `configure()` calls it once with
   `("openai-codex", { apiKey: "<file access token>" })`.
2. **Refresh then register**: expired file + injected `refreshToken` →
   registered apiKey is the refreshed access token; file rewritten.
3. **Aggregate error**: `authPath` inside a forbidden path AND a rejected env
   name set → `configure()` rejects with a message containing both check names;
   the spy register function is never called.
4. **Env hygiene off**: same env but `envHygiene: false` → no env check failure.
5. **Middleware**: `middleware()` invokes `next()` after configuring; a
   failing `configure()` propagates (rejects) and does not call `next()`.
6. **Single-flight**: injected `refreshToken` that counts invocations and
   resolves on a manually-controlled promise; fire 5 concurrent middleware
   invocations → `refreshToken` called exactly once, all 5 complete.
7. **registerProvider unavailable**: `registerProvider: undefined as never`
   forced via an injected non-function → clear error message (from Step 2.3).

**Verify**: `pnpm test` → exit 0, all cases above present and passing.

## Test plan

Covered in Step 4. Pattern files: `tests/credential-store.test.ts` (from Plan
001) and the reference's `tests/model-auth.test.ts` for the no-secret-leak
assertions.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` and `pnpm build` exit 0
- [ ] `pnpm test` exits 0; both new test files present with all listed cases
- [ ] `grep -rn "pi-ai/compat\|from \"hono\"\|from 'hono'" src/` returns no matches
- [ ] `grep -rn "mario\|FLUPER_" src/` returns no matches
- [ ] `node -e "import('./dist/index.js').then(m => console.log(typeof m.codexAuth))"` prints `function`
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `docs/plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001 is not DONE, or `src/credential-store.ts` lacks any export this
  plan consumes (`resolveApiKey`, `validateAuthPath`, `readAuthStatus`,
  `expandHome`, `AuthCheck`, `CodexAuthStatus`).
- `import { registerProvider } from "@flue/runtime"` fails to typecheck or the
  symbol is missing in `@flue/runtime@1.0.0-beta.9` (inspect
  `node_modules/@flue/runtime` exports before assuming — the reference uses
  exactly this import at `model-auth.ts:5`, so a failure means an environment
  problem, not a plan problem).
- Satisfying Hono's `MiddlewareHandler` structurally proves impossible without
  importing `hono` — report the type error rather than adding the import.

## Maintenance notes

- The provider ID `"openai-codex"` is a contract with Pi's catalog and users'
  model specifiers (`openai-codex/gpt-5.5`); never rename it.
- Flue's `registerProvider` replaces the previous registration per provider ID
  (calls do not accumulate) — that is what makes per-request re-registration
  safe. If Flue changes that semantic in a future beta, revisit `middleware()`.
- Reviewers should scrutinize the single-flight logic for promise-slot leaks
  on rejection (the slot must clear on failure or auth can wedge permanently).
- Deferred: a `dispose()`/cache-TTL story for long-lived processes that never
  receive requests (startup `configure()` + systemd restart covers it today).
