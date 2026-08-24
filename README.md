# flue-codex-oauth

> OpenAI Codex subscription OAuth for Flue 2, backed by an owner-only local credential file with request-time refresh.

## Requirements

- Flue `^2.0.0`
- Node `>=22.19.0`
- A ChatGPT/Codex subscription

This major is for Flue 2 only. The `0.x` releases remain available for Flue beta hosts.

## Install

```bash
pnpm add flue-codex-oauth
pnpm exec flue-codex-login
```

The login command runs OpenAI's device-code flow and writes
`~/.flue/openai-codex.json` by default.

## Register the provider

Create the provider and hand it to Flue 2's `setProvider()` before an agent runs:

```ts
import { setProvider } from "@flue/runtime";
import { codexProvider } from "flue-codex-oauth";

setProvider(
  codexProvider({
    authPath: "~/.flue/openai-codex.json",
    forbiddenPaths: [repoRoot, runtimeWorkdir, ...sqliteStorePaths],
    refreshSkewMs: 300_000,
  }),
);
```

Then select a Codex model:

```ts
model: "openai-codex/gpt-5.5"
```

`codexProvider()` returns a Pi `Provider`. Its auth resolver reads the credential
file for every model request, refreshes credentials near expiry, atomically
rewrites the file, and returns only the access token to Pi. No HTTP middleware
is required, so dispatch-only agents receive the same refresh behavior.

Flue's `run` command loads an agent module without loading `app.ts`. If that
agent must also run through `flue run`, register the provider in the agent
module instead.

See [`examples/basic`](examples/basic) for a Flue 2 app.

## Startup preflight

Required-auth hosts can fail startup closed before serving traffic:

```ts
import { preflight } from "flue-codex-oauth";

const status = await preflight({
  authPath: "~/.flue/openai-codex.json",
  forbiddenPaths: [repoRoot, runtimeWorkdir, ...sqliteStorePaths],
});
```

The result contains safe metadata only: `authPath`, `expiresAt`, and optional
`accountId`. It never includes access or refresh tokens.

## Options

`codexProvider(options)` and `preflight(options)` accept:

| Option | Default | Purpose |
| --- | --- | --- |
| `authPath` | `~/.flue/openai-codex.json` | Auth JSON file to read, refresh, and atomically rewrite. `~/` is expanded. |
| `forbiddenPaths` | `[process.cwd()]` | Paths the auth file must not equal or live inside. SQLite `-wal`/`-shm` sidecars are also rejected. |
| `refreshSkewMs` | `300_000` | Refresh this many milliseconds before expiry. |

Environment hygiene is always enforced against the built-in Codex OAuth
environment-name set. It cannot be disabled through provider options.

`FLUE_CODEX_AUTH_PATH` is used by the login and doctor CLI when `--auth-path`
is not supplied. It is a path, not credential material.

## Doctor

Validate the package, Flue 2 integration, path safety, permissions,
environment hygiene, and credential refresh without printing tokens:

```bash
pnpm exec flue-codex-login --doctor
# alias
pnpm exec flue-codex-login --check
```

A ready integration exits with status 0; any failed check exits with status 1.

## Security

- Credentials stay in a local file and are never read from OAuth environment variables.
- Refreshes are serialized per auth path and re-read under the lock so concurrent requests share one rotating-token exchange.
- The auth path cannot be a symlink; lexical and canonical paths are checked against every forbidden path.
- Auth and parent-directory permissions must be owner-only on POSIX systems.
- Refresh writes use collision-resistant temporary names, `0600` mode, and atomic rename.
- Parse and refresh errors use fixed messages so upstream responses or malformed JSON cannot leak tokens.

Placeholder values such as `PH_TOKEN` or strings containing `placeholder` are
allowed in the built-in Codex OAuth environment-name set so deployment
templates can declare shape without carrying secrets.

## Local release verification

```bash
pnpm install --frozen-lockfile
pnpm prepublishOnly
pnpm pack
```

The release workflow builds the package, runs the publish gate, and attaches
the `.tgz` artifact to the matching GitHub release.
