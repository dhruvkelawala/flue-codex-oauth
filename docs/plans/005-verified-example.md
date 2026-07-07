# Plan 005: Add a CI-verified example Flue app under `examples/basic`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 53a6272..HEAD -- examples/ package.json`
> Plans 001–004 legitimately touched `package.json` and `src/` — those diffs
> are expected. Verify plans 002 and 003 are marked DONE in
> `docs/plans/README.md`; if not, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: docs/plans/002-codex-auth-factory.md, docs/plans/003-login-cli.md
- **Category**: dx + tests (integration)
- **Planned at**: commit `53a6272`, 2026-07-07

## Why this matters

The packaged unit tests exercise the credential store through injected seams
(`refreshToken`, `registerProvider` spies) — nothing proves the package
composes with a *real* Flue app against the real `@flue/runtime` peer. A
minimal example app closes that gap three ways at once: it is living
documentation the README Quickstart can be excerpted from, an integration
gate that catches peer-contract drift when `@flue/runtime` moves, and a
reproduction environment for user issues. The one failure mode of examples —
rot — is neutralized by wiring its typecheck into the package's own
verification gate. Deliberately NOT in scope: a scaffolding command
(`create-flue-codex-app` or similar) — Flue owns project creation via
`flue init` and integration via `flue add`; a per-package scaffolder would
compete with the framework and rot with every beta. This decision is recorded
in the index's rejected list; do not add one.

## Current state

After plans 001–004 the package at the repo root exports `codexAuth()` from
`src/index.ts` (built to `dist/index.js`), ships `dist/bin/login.js` as
`flue-codex-login`, and has `"files": ["dist"]` — so an `examples/` directory
will not leak into the npm tarball. There is no `examples/` directory and no
workspace configuration; the repo is a single package.

### Verified facts about Flue project shape (from the Flue docs and a working reference app)

A minimal Flue Node app consists of `flue.config.ts`, `src/app.ts`, and agent
modules under `src/`. The configuration file (verified against
`flue docs read reference/configuration` and the fluper-mario reference app's
actual `flue.config.ts`):

```ts
// flue.config.ts
import { defineConfig } from "@flue/cli/config";

export default defineConfig({
  target: "node",
});
```

`target` is required unless passed via `--target`. Flue uses `<root>/src` as
the source root when it exists.

An agent module (from `flue docs read guide/models`):

```ts
// src/agents/assistant.ts
import { defineAgent } from "@flue/runtime";

export default defineAgent(() => ({
  model: "openai-codex/gpt-5.5",
}));
```

The custom-app entrypoint (from `flue docs read guide/routing`): `src/app.ts`
exports a Hono application and mounts `flue()` explicitly; because the app
imports `Hono`, `hono` must be a direct dependency of the example.

A working Flue Node app's `tsconfig.json` (copied from the fluper-mario
reference at commit `057c5f1` — a known-good configuration for typechecking
Flue `.ts` source with `allowImportingTsExtensions`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["flue.config.ts", "src/**/*.ts"]
}
```

### Decided design (do not re-litigate)

1. **`examples/basic` is a standalone package**, `"private": true`, depending
   on the parent via `"flue-codex-oauth": "file:../.."`. No pnpm workspace —
   keeping the root a plain single package avoids changing its publish
   behavior.
2. **The verification gate is `tsc --noEmit`** in the example against the
   built parent (`dist/` + its `.d.ts`), wired into the root as
   `example:check` and appended to `prepublishOnly`. A full `flue build` is
   attempted once and its outcome *recorded*, but it is not the gate — the
   framework is beta and its build may impose requirements (e.g. a database
   adapter) that are Flue's business, not this package's.
3. **The example must exercise the real public API with zero test seams**:
   `codexAuth()` with at most `authPath` configured, `configure()` at
   startup, `middleware()` on `*` — mirroring the reference wiring pattern in
   fluper-mario's `src/app.ts` (configure once at startup, re-configure per
   request).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build parent | `corepack pnpm build` (repo root) | exit 0, `dist/` fresh |
| Install example | `corepack pnpm -C examples/basic install` | exit 0 |
| Typecheck example | `corepack pnpm -C examples/basic typecheck` | exit 0 |
| Root gate | `corepack pnpm example:check` | exit 0 |

**Environment note**: use Node ≥ 20 and pnpm 10 via
`export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"` + `corepack pnpm <cmd>`.

## Scope

**In scope** (the only files you should create or modify):
- `examples/basic/package.json` (create)
- `examples/basic/tsconfig.json` (create)
- `examples/basic/flue.config.ts` (create)
- `examples/basic/src/app.ts` (create)
- `examples/basic/src/agents/assistant.ts` (create)
- `examples/basic/README.md` (create)
- `examples/basic/.gitignore` (create: `node_modules/`, `dist/`, `pnpm-lock.yaml` — the example lockfile churns with the parent and is not worth tracking)
- `package.json` (root: add `example:check` script, extend `prepublishOnly`)
- `README.md` (root: one line pointing at `examples/basic`)
- `docs/plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `src/`, `tests/` — if the example reveals an API bug, STOP and report.
- No pnpm-workspace.yaml; no scaffolding command; no additional examples.
- Anything under `/Users/dhruvkelawala/development/fluper-mario`.

## Git workflow

- Work on `main`; conventional commits (e.g. `feat(examples): add verified basic example app`).
- Do NOT push.

## Steps

### Step 1: Create the example package

`examples/basic/package.json`:

```json
{
  "name": "flue-codex-oauth-example-basic",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "dev": "flue dev --target node",
    "build": "flue build --target node",
    "login": "flue-codex-login"
  },
  "dependencies": {
    "flue-codex-oauth": "file:../..",
    "@flue/runtime": "1.0.0-beta.9",
    "hono": "^4"
  },
  "devDependencies": {
    "@flue/cli": "1.0.0-beta.9",
    "@types/node": "^24",
    "typescript": "^5"
  }
}
```

Add the `tsconfig.json` and `flue.config.ts` exactly as excerpted in
"Current state".

**Verify**: `corepack pnpm build` (root, so `dist/` exists) then
`corepack pnpm -C examples/basic install` → exit 0.

### Step 2: Write the app source

`examples/basic/src/agents/assistant.ts` — the agent module excerpted in
"Current state" (model `openai-codex/gpt-5.5`).

`examples/basic/src/app.ts`:

```ts
import { codexAuth } from "flue-codex-oauth";
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

const codex = codexAuth(); // defaults: ~/.flue/openai-codex.json

await codex.configure(); // startup: refresh if stale, registerProvider("openai-codex", ...)

const app = new Hono();

app.use("*", codex.middleware()); // keep the registered token fresh per request

app.route("/", flue());

export default app;
```

If the real API from Plan 002 differs (e.g. `middleware()` signature), adapt
the *example* to the real API — never the package. If the example cannot be
written against the public API at all, that is a STOP condition.

**Verify**: `corepack pnpm -C examples/basic typecheck` → exit 0.

### Step 3: Example README + build attempt

`examples/basic/README.md`: how to run it end to end —
`pnpm install`, `pnpm login` (device-code flow, one time),
`pnpm dev`, then send the agent a prompt (point at
`flue docs read cli/run` / the Flue quickstart for prompting). State
explicitly that the auth file lives at `~/.flue/openai-codex.json` and is
never inside the project.

Then attempt `corepack pnpm -C examples/basic build` **once**:
- If it exits 0: add a "Build" section to the example README saying
  `pnpm build` produces the Node artifact.
- If it fails: copy the exact error into a "Known limitations" section of the
  example README verbatim, note that `typecheck` is the supported gate, and
  move on. Do NOT chase framework-side build requirements (database adapters,
  env expectations) — that is out of scope.

**Verify**: `test -f examples/basic/README.md` → exists; whichever branch was
taken is reflected in it (`grep -E "Build|Known limitations" examples/basic/README.md` → ≥1 match).

### Step 4: Wire the gate into the root

In the root `package.json`:
1. Add `"example:check": "pnpm -C examples/basic install && pnpm -C examples/basic typecheck"`.
2. Extend `prepublishOnly` to `"pnpm typecheck && pnpm test && pnpm build && pnpm example:check"`.
3. Add one line to the root `README.md` (e.g. under Quickstart or at the end):
   `See [examples/basic](examples/basic) for a complete runnable app.`

**Verify**: `corepack pnpm example:check` → exit 0, and
`npm pack --dry-run --json | node -e "const l=JSON.parse(require('fs').readFileSync(0,'utf8'))[0].files.map(f=>f.path); for (const bad of l) if (bad.startsWith('examples/')) { console.error('leaked', bad); process.exit(1) } console.log('pack ok')"` → `pack ok`.

## Test plan

The example *is* the test — an integration typecheck of the public API against
the real `@flue/runtime` peer, gated via `example:check` in `prepublishOnly`.
Run the full root suite (`corepack pnpm test`) once at the end to confirm
nothing regressed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `corepack pnpm example:check` exits 0 from the repo root
- [ ] `examples/basic/src/app.ts` imports `codexAuth` from `"flue-codex-oauth"` (the package name, not a relative path)
- [ ] `grep -rn "refreshToken\|registerProvider:" examples/basic/src/` returns no matches (no test seams in the example)
- [ ] Root `prepublishOnly` includes `example:check`
- [ ] `npm pack --dry-run` contains no `examples/` paths
- [ ] `corepack pnpm test` (root) exits 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `docs/plans/README.md` status row for 005 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plans 002/003 are not DONE, or `dist/index.d.ts` does not exist after a
  fresh root build.
- The example cannot typecheck against the package's public API without
  changing anything under the root `src/` — report the exact type error; the
  fix belongs in a package plan, not here.
- `file:../..` installation fails to resolve the built package (e.g. pnpm
  links the source dir but `exports` points at a missing `dist/`) after one
  re-run of the root build.
- `@flue/cli@1.0.0-beta.9` or `@flue/runtime@1.0.0-beta.9` cannot be installed
  in the example (registry/version issue).

## Maintenance notes

- When the `@flue/runtime` peer range moves, bump the example's pinned
  versions in the same commit — `example:check` is what makes that bump
  honest.
- The example's `src/app.ts` and the root README Quickstart must stay
  textually in sync; reviewers should diff them when either changes.
- `pnpm -C examples/basic install` inside `prepublishOnly` adds seconds and
  network access to publishes; if that becomes annoying, split
  `example:check` into a CI-only job — but never delete the gate.
- Deferred (recorded as rejected in the index): a scaffolding command; a
  second example showing a Cloudflare target (the package is Node-file-system
  based, so Cloudflare support is a design question first, not an example).
