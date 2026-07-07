# Plan 001: Establish the build/test baseline and implement the core Codex credential store

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 94f94e7..HEAD -- package.json tsconfig.json src/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt (extraction) + tests (baseline)
- **Planned at**: commit `94f94e7`, 2026-07-07

## Why this matters

This package's entire value proposition is a *safe credential lifecycle* for
OpenAI Codex subscription OAuth in Flue apps: tokens live in a single local
file (never env vars, never the repo), written atomically with owner-only
permissions, refreshed automatically before expiry. This plan builds that core
module by extracting proven code from a private reference implementation
(fluper-mario). Everything else in the package (provider registration, the
login CLI) layers on top of this module, so it lands first, together with the
project's typecheck/test/build baseline.

## Current state

The target repo (`~/development/flue-codex-oauth`) is a skeleton: `package.json`,
`tsconfig.json`, `.gitignore`, `README.md`, an empty `src/`, and no lockfile.
`package.json` declares scripts that do not work yet:

```json
// package.json (excerpt, as scaffolded)
"scripts": {
  "build": "tsc -p tsconfig.build.json",   // tsconfig.build.json does not exist
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
},
"dependencies": { "@earendil-works/pi-ai": "0.80.3" },
"peerDependencies": { "@flue/runtime": ">=1.0.0-beta.9 <2", "hono": ">=4" }
```

`tsconfig.json` has `"rootDir": "src"`, `"include": ["src"]`, `"module": "NodeNext"`,
`"verbatimModuleSyntax": true`, `strict` mode.

### Reference implementation (read-only — do NOT modify it)

The code to extract lives in the fluper-mario worktree at
`/Users/dhruvkelawala/development/fluper-mario/.claude/worktrees/gifted-pasteur-a3a522`
(commit `057c5f1`). If that path no longer exists, try the repo root
`/Users/dhruvkelawala/development/fluper-mario` — the same files exist on its
main branch. The source file is:

- `src/runtime/codex-subscription-auth.ts` (278 lines) — the whole credential
  store: read + validate the auth file, refresh when stale, atomic re-write.

Key excerpts you must preserve semantically (from `codex-subscription-auth.ts`):

The refresh-on-read core (lines 33–67):

```ts
export async function resolveCodexSubscriptionApiKey(
  options: CodexSubscriptionAuthOptions,
): Promise<{ apiKey: string; status: CodexSubscriptionAuthStatus }> {
  assertCodexAuthPath(options);
  const authFile = readCodexAuthFile(options.authPath);
  const now = options.now?.() ?? Date.now();
  const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS; // 5 * 60 * 1000
  let credentials = authFile.credentials;
  let lastRefresh = authFile.lastRefresh;
  if (now >= credentials.expires - refreshSkewMs) {
    const refreshToken = options.refreshToken ?? refreshOpenAICodexToken;
    credentials = await refreshToken(credentials.refresh);
    validateCredentials(credentials, options.authPath);
    lastRefresh = new Date(now).toISOString();
    await writeCodexAuthFileAtomic(options.authPath, { provider: CODEX_PROVIDER_ID, credentials, lastRefresh });
  }
  return { apiKey: credentials.access, status: statusFromAuthFile(...) };
}
```

The atomic write (lines 205–218) — temp file with `wx` flag + mode 0600, chmod,
rename; temp file removed on failure:

```ts
async function writeCodexAuthFileAtomic(authPath: string, authFile: CodexAuthFile): Promise<void> {
  const dir = dirname(authPath);
  const tempPath = resolve(dir, `.openai-codex.${process.pid}.${Date.now()}.tmp`);
  const payload = `${JSON.stringify(authFile, null, 2)}\n`;
  try {
    await fsPromises.writeFile(tempPath, payload, { mode: 0o600, flag: "wx" });
    await fsPromises.chmod(tempPath, 0o600);
    await fsPromises.rename(tempPath, authPath);
  } catch (error) {
    await fsPromises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
```

The permission check (lines 235–245) — file must be `0o600`-equivalent, parent
dir not group/world writable, skipped on win32:

```ts
function codexAuthFileModeIsSafe(authPath: string): boolean {
  if (process.platform === "win32" || !existsSync(authPath)) return true;
  try {
    const fileStat = statSync(authPath);
    const parentStat = statSync(dirname(authPath));
    return (fileStat.mode & 0o077) === 0 && (parentStat.mode & 0o022) === 0;
  } catch {
    return false;
  }
}
```

The auth-file JSON shape (lines 27–31) — keep it byte-compatible so users can
migrate existing files:

```ts
interface CodexAuthFile {
  provider: "openai-codex";
  credentials: OAuthCredentials;   // { access, refresh, expires, accountId? } from @earendil-works/pi-ai/oauth
  lastRefresh?: string;            // ISO timestamp
}
```

### Decided design changes for the extraction (do not re-litigate)

1. **Decouple from mario-config.** The reference options interface hardcodes
   `projectRoot`, `runtimeWorkdir`, `sqlitePath` (lines 9–17) and validates the
   auth path against each. Replace those three fields with a single generic
   `forbiddenPaths?: string[]` — the auth path must not be equal to or inside
   any listed path. Default: `[process.cwd()]`. Drop the SQLite-sidecar
   special case (`-wal`/`-shm`, lines 247–251) — callers can add those paths
   to `forbiddenPaths` themselves.
2. **Own the check type.** The reference imports `RuntimeCheck` from its
   `config.ts`. Define the equivalent locally:
   `export interface AuthCheck { name: string; ok: boolean; severity: "error" | "warning"; message: string; }`
3. **Add `~` expansion.** The reference expands `~/` in a different module.
   Include an `expandHome` helper here (see the reference's
   `scripts/login-openai-codex.mjs` lines 110–114 for the exact behavior:
   `~` → homedir, `~/x` → join(homedir, x), otherwise unchanged).
4. **Export the atomic writer.** `writeCodexAuthFileAtomic` is module-private
   in the reference; export it (renamed `writeAuthFileAtomic`) — Plan 003's
   login CLI reuses it.
5. **pi-ai only via `/oauth`.** Import `refreshOpenAICodexToken` and
   `type OAuthCredentials` from `@earendil-works/pi-ai/oauth` only. Never
   import from `@earendil-works/pi-ai/compat` anywhere in this package —
   Pi's registries are module-scoped, and this package's copy of pi-ai is
   not the host app's copy.

## Commands you will need

| Purpose   | Command          | Expected on success |
|-----------|------------------|---------------------|
| Install   | `pnpm install`   | exit 0, lockfile created |
| Typecheck | `pnpm typecheck` | exit 0, no errors   |
| Tests     | `pnpm test`      | all pass            |
| Build     | `pnpm build`     | exit 0, `dist/` populated |

**Environment note**: this machine's default `node` is v14 and its global
`pnpm` is v6, both too old. Prefix every command session with:
`export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"` and invoke pnpm as
`corepack pnpm <cmd>` (the repo has no `packageManager` field yet — step 1 adds it).

## Scope

**In scope** (the only files you should create or modify):
- `package.json` (add `packageManager`, adjust if needed)
- `tsconfig.build.json` (create)
- `src/credential-store.ts` (create)
- `src/index.ts` (create)
- `tests/credential-store.test.ts` (create)
- `pnpm-lock.yaml` (created by install)
- `docs/plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- Anything under `/Users/dhruvkelawala/development/fluper-mario` — the
  reference codebase is read-only.
- `README.md` — rewritten in Plan 004.
- Provider registration / `registerProvider` — Plan 002.
- Any bin / CLI code — Plan 003.

## Git workflow

- Work directly on `main` (single-author greenfield repo, no branch protection).
- One commit per step, conventional-commit style, e.g.
  `feat(core): add credential store with atomic refresh`.
- Do NOT push.

## Steps

### Step 1: Make the scaffold's own commands pass

1. Add `"packageManager": "pnpm@10.17.1"` to `package.json`.
2. Create `tsconfig.build.json`:
   ```json
   {
     "extends": "./tsconfig.json",
     "exclude": ["tests", "**/*.test.ts"]
   }
   ```
3. Create a placeholder `src/index.ts` containing only `export {};`.
4. Change the `test` script to `"vitest run --passWithNoTests"` (reverted in
   step 4 once tests exist — or leave the flag; it is harmless).
5. Run `pnpm install`.

**Verify**: `pnpm typecheck && pnpm build && pnpm test` → all exit 0.

### Step 2: Create `src/credential-store.ts`

Port `codex-subscription-auth.ts` from the reference (path above) applying the
five decided design changes. The public surface must be exactly:

```ts
export interface CodexCredentialStoreOptions {
  /** Absolute path (after ~ expansion) to the auth JSON file. */
  authPath: string;
  /** Paths the auth file must not live inside. Default: [process.cwd()]. */
  forbiddenPaths?: string[];
  /** Refresh this long before expiry. Default: 300_000 (5 min). */
  refreshSkewMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
  /** Injectable refresher, for tests. Default: refreshOpenAICodexToken. */
  refreshToken?: (refresh: string) => Promise<OAuthCredentials>;
}

export interface CodexAuthStatus {
  configured: boolean;
  authPath: string;
  accountId?: string;
  expiresAt?: string;
  lastRefresh?: string;
}

export interface AuthCheck {
  name: string;
  ok: boolean;
  severity: "error" | "warning";
  message: string;
}

export function expandHome(value: string): string;
export function validateAuthPath(options: CodexCredentialStoreOptions): AuthCheck[];
export function readAuthStatus(options: CodexCredentialStoreOptions): CodexAuthStatus;
export async function resolveApiKey(options: CodexCredentialStoreOptions): Promise<{ apiKey: string; status: CodexAuthStatus }>;
export async function writeAuthFileAtomic(authPath: string, authFile: { provider: "openai-codex"; credentials: OAuthCredentials; lastRefresh?: string }): Promise<void>;
```

Semantics to preserve from the reference (all excerpted above):
- `resolveApiKey` throws (via the check list) before touching the network if
  any `error`-severity check fails; check names: keep the reference's names but
  strip the `model-auth-local-` prefix (e.g. `codex-auth-path-absolute`,
  `codex-auth-path-outside-forbidden`, `codex-auth-file-mode`).
- Refresh condition `now >= credentials.expires - refreshSkewMs`; on refresh,
  validate the returned credentials, stamp `lastRefresh`, atomically re-write.
- Auth-file parsing errors carry the path and the reason
  (`Invalid Codex auth file <path>: ...`) exactly as the reference does at
  lines 150–182.
- `readAuthStatus` never throws; on unreadable file it returns
  `{ configured: existsSync(path), authPath }` (reference lines 122–137).
- The `isPathInside` helper (reference lines 253–259): relative-path based,
  treats equality as inside.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Export from `src/index.ts`

Replace the placeholder with re-exports of everything public in
`credential-store.ts` (types included).

**Verify**: `pnpm build` → exit 0 and `ls dist/index.js dist/credential-store.js` shows both files.

### Step 4: Write `tests/credential-store.test.ts`

Model the structure on the reference's `tests/model-auth.test.ts` (vitest,
`mkdtempSync(join(tmpdir(), ...))` sandboxes, a `writeAuthFile(path, expires)`
helper that writes a valid file with mode 0o600 then `chmodSync(path, 0o600)`).
Cases to cover:

1. **Happy path, no refresh**: valid file expiring in +60s with default skew
   overridden to 0 → `resolveApiKey` returns the stored `access`, does not call
   the injected `refreshToken` (inject one that throws).
2. **Refresh path**: file with `expires` in the past, injected `now` and
   `refreshToken` returning new credentials → returned `apiKey` is the new
   access token; the file on disk now holds the new credentials; the result
   JSON-stringifies without containing the refresh token (mirror reference
   test at lines 180–211).
3. **Forbidden path rejection**: `authPath` inside a listed forbidden path →
   `resolveApiKey` rejects; `validateAuthPath` returns a failing
   `codex-auth-path-outside-forbidden` check.
4. **Default forbidden path**: with no `forbiddenPaths` and `authPath` inside
   `process.cwd()` → rejected.
5. **Relative path rejection**: non-absolute `authPath` → failing
   `codex-auth-path-absolute` check.
6. **Unsafe file mode** (skip on win32): chmod the auth file to 0o644 →
   failing `codex-auth-file-mode` check.
7. **Malformed file**: wrong `provider`, missing `credentials.access`, and
   non-object top level each produce an error mentioning the auth path.
8. **`readAuthStatus` never throws**: on a malformed file returns
   `{ configured: true, authPath }`; on a missing file `{ configured: false, ... }`.
9. **Atomic writer**: `writeAuthFileAtomic` leaves no `*.tmp` file behind on
   success, and the written file has mode 0o600 (check `statSync(...).mode & 0o777`,
   skip on win32).
10. **`expandHome`**: `~` → homedir, `~/x` → `join(homedir(), "x")`, `/abs` unchanged.

**Verify**: `pnpm test` → exit 0, all listed cases present and passing.

## Test plan

Covered by Step 4 above; `tests/credential-store.test.ts` is the deliverable.
Pattern file: the reference's `tests/model-auth.test.ts` (its `writeAuthFile`
helper at lines 214–229 is directly reusable).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm build` exits 0; `dist/index.js` and `dist/index.d.ts` exist
- [ ] `pnpm test` exits 0 with ≥10 passing tests in `tests/credential-store.test.ts`
- [ ] `grep -rn "mario\|fluper\|FLUPER_" src/` returns no matches (fully de-Mario'd)
- [ ] `grep -rn "pi-ai/compat" src/ tests/` returns no matches
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `docs/plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The reference file `src/runtime/codex-subscription-auth.ts` cannot be found
  at either reference path, or its content does not match the excerpts above.
- `@earendil-works/pi-ai@0.80.3` fails to install, or
  `@earendil-works/pi-ai/oauth` does not export `refreshOpenAICodexToken` and
  `OAuthCredentials` (check `node_modules/@earendil-works/pi-ai/package.json`
  `exports` map before assuming).
- `verbatimModuleSyntax` or `NodeNext` resolution produces import errors you
  cannot fix by adding `type` qualifiers or `.js` extensions to relative imports.

## Maintenance notes

- The auth-file JSON shape is a compatibility contract with files produced by
  fluper-mario's login script; never change field names without a migration.
- `forbiddenPaths` semantics ("equal to or inside") is relied on by Plan 002's
  factory defaults and Plan 003's login CLI guard — keep the helper exported
  or at least stable.
- Deferred: single-flight refresh locking across concurrent calls (handled at
  the factory layer in Plan 002, not here).
