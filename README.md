# flue-codex-oauth

> OpenAI Codex and Anthropic Claude subscription OAuth for Flue 2, backed by
> owner-only local credential files with request-time refresh.

## Requirements

- Flue `^2.0.0`
- Node `>=22.19.0`
- A ChatGPT/Codex subscription (for the Codex provider), and/or a
  Claude Pro/Max subscription (for the Claude provider)

This major is for Flue 2 only. The `0.x` releases remain available for Flue beta hosts.

## Install

```bash
pnpm add flue-codex-oauth

# Codex (OpenAI device-code flow)
pnpm exec flue-codex-login

# Claude (Anthropic browser OAuth flow with manual paste fallback)
pnpm exec flue-claude-login
```

`flue-codex-login` runs OpenAI's device-code flow and writes
`~/.flue/openai-codex.json` by default. `flue-claude-login` runs the Claude
Pro/Max browser OAuth (PKCE) flow — with a local callback listener,
paste-the-redirect-URL fallback, and bounded token-endpoint retries — and
writes `~/.flue/anthropic.json` by default.

## Register the providers

Create the providers and hand them to Flue 2's `setProvider()` before an agent
runs. Register one or both:

```ts
import { setProvider } from "@flue/runtime";
import { claudeProvider, codexProvider } from "flue-codex-oauth";

setProvider(
  codexProvider({
    authPath: "~/.flue/openai-codex.json",
    forbiddenPaths: [repoRoot, runtimeWorkdir, ...sqliteStorePaths],
    refreshSkewMs: 300_000,
  }),
);

setProvider(
  claudeProvider({
    authPath: "~/.flue/anthropic.json",
    forbiddenPaths: [repoRoot, runtimeWorkdir, ...sqliteStorePaths],
    refreshSkewMs: 300_000,
  }),
);
```

Then select a model:

```ts
model: "openai-codex/gpt-5.5"
// or
model: "anthropic/claude-sonnet-4-6"
```

Both factories return a Pi `Provider`. Their auth resolvers read the
credential file for every model request, refresh credentials near expiry,
atomically rewrite the file, and return only the access token to Pi. No HTTP
middleware is required, so dispatch-only agents receive the same refresh
behavior.

For Claude, Pi's Anthropic API adapter detects the subscription OAuth token
and applies most Claude Code request compatibility itself (Bearer auth, the
required identity system prompt, OAuth beta headers, and tool-name
normalization). This package adds the remaining billing-header compatibility
through Pi's `onPayload` hook while preserving any host-provided payload hook.

Flue's `run` command loads an agent module without loading `app.ts`. If that
agent must also run through `flue run`, register the provider in the agent
module instead.

See [`examples/basic`](examples/basic) for a Flue 2 app using both providers.

## Startup preflight

Required-auth hosts can fail startup closed before serving traffic:

```ts
import { claudePreflight, codexPreflight } from "flue-codex-oauth";

const codexStatus = await codexPreflight({
  authPath: "~/.flue/openai-codex.json",
  forbiddenPaths: [repoRoot, runtimeWorkdir, ...sqliteStorePaths],
});

const claudeStatus = await claudePreflight({
  authPath: "~/.flue/anthropic.json",
  forbiddenPaths: [repoRoot, runtimeWorkdir, ...sqliteStorePaths],
});
```

The results contain safe metadata only: `authPath`, `expiresAt`, and (Codex
only) an optional `accountId`. They never include access or refresh tokens.
For non-throwing status snapshots, use `codexAuthStatus()` or
`claudeAuthStatus()`; for startup safety reports, use `codexProviderChecks()`
or `claudeProviderChecks()`.

## Options

`codexProvider(options)`, `claudeProvider(options)`, `preflight(options)`, and
`claudePreflight(options)` accept:

| Option | Default | Purpose |
| --- | --- | --- |
| `authPath` | `~/.flue/openai-codex.json` (Codex) / `~/.flue/anthropic.json` (Claude) | Auth JSON file to read, refresh, and atomically rewrite. `~/` is expanded. |
| `forbiddenPaths` | `[process.cwd()]` | Paths the auth file must not equal or live inside. SQLite `-wal`/`-shm` sidecars are also rejected. |
| `refreshSkewMs` | `300_000` | Refresh this many milliseconds before expiry. |

Environment hygiene is always enforced against the built-in OAuth
environment-name set of each provider. It cannot be disabled through provider
options. The Claude set additionally rejects `ANTHROPIC_API_KEY` values that
carry a subscription OAuth token (`sk-ant-oat…`); plain Anthropic API keys are
left alone.

`FLUE_CODEX_AUTH_PATH` and `FLUE_CLAUDE_AUTH_PATH` are used by the matching
login and doctor CLI when `--auth-path` is not supplied. They are paths, not
credential material.

## Doctor

Validate the package, Flue 2 integration, path safety, permissions,
environment hygiene, and credential refresh without printing tokens:

```bash
pnpm exec flue-codex-login --doctor
pnpm exec flue-claude-login --doctor
# alias
pnpm exec flue-codex-login --check
```

A ready integration exits with status 0; any failed check exits with status 1.

## Security

- Credentials stay in local files and are never read from OAuth environment variables.
- Claude login and refresh token endpoint calls use bounded retry/backoff for transient failures.
- Refreshes are serialized per auth path and re-read under the lock so concurrent requests share one rotating-token exchange.
- An auth path cannot be a symlink; lexical and canonical paths are checked against every forbidden path.
- Auth and parent-directory permissions must be owner-only on POSIX systems.
- Refresh writes use collision-resistant temporary names, `0600` mode, and atomic rename.
- Parse and refresh errors use fixed messages so upstream responses or malformed JSON cannot leak tokens.

Placeholder values such as `PH_TOKEN` or strings containing `placeholder` are
allowed in the built-in OAuth environment-name sets so deployment templates
can declare shape without carrying secrets.

## Local release verification

```bash
pnpm install --frozen-lockfile
pnpm prepublishOnly
pnpm pack
```

The release workflow builds the package, runs the publish gate, and attaches
the `.tgz` artifact to the matching GitHub release.
