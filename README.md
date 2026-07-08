# flue-codex-oauth

> OpenAI Codex subscription OAuth for Flue apps, backed by a local credential file and automatic refresh.

## Quickstart

Install the package in a Flue app that already depends on `@flue/runtime`:

```bash
pnpm add flue-codex-oauth
```

Create the local Codex auth file once:

```bash
npx flue-codex-login
```

Wire the provider in `src/app.ts`:

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

Point your agent at Codex with a model specifier such as:

```ts
model: "openai-codex/gpt-5.5"
```

See [examples/basic](examples/basic) for a complete runnable app.

## Overview

`flue-codex-oauth` owns the credential lifecycle for the `openai-codex` provider:

- Runs a one-time device-code login through `flue-codex-login`.
- Stores OAuth credentials in one local JSON file.
- Refreshes stale credentials before registration.
- Calls the host app's `@flue/runtime` `registerProvider("openai-codex", { apiKey })`.
- Provides Hono-compatible middleware that reconfigures per request so long-running apps keep a fresh token.

It does not own model selection, app configuration loading, or a richer OAuth consent UI beyond the device-code prompt. Windows permission enforcement is intentionally limited: POSIX mode checks are skipped on Windows, matching the runtime credential-store behavior.

## Configure

### `CodexAuthOptions`

Pass these to `codexAuth(options)`.

| Option | Default | Purpose |
|--------|---------|---------|
| `authPath` | `~/.flue/openai-codex.json` | Auth JSON file to read, refresh, and register from. `~/` is expanded. |
| `forbiddenPaths` | `[process.cwd()]` | Paths the auth file must not be equal to or inside. Use this to keep credentials out of repos, workdirs, and stores. |
| `refreshSkewMs` | `300_000` | Refresh this many milliseconds before credential expiry. |
| `rejectedEnvNames` | `[]` | Extra env var names to reject alongside the built-in Codex OAuth credential names. |
| `envHygiene` | `true` | Set to `false` to skip env hygiene checks. |
| `env` | `process.env` | Env map used by checks. Mainly useful in tests or custom bootstrapping. |
| `now` | `Date.now` | Clock used by refresh decisions. Mainly useful in tests. |
| `refreshToken` | `refreshOpenAICodexToken` | Token refresher. Mainly useful in tests. |
| `registerProvider` | host `@flue/runtime` `registerProvider` | Provider registration function. Mainly useful in tests. |

### Login CLI Environment

| Name | Default | Purpose |
|------|---------|---------|
| `FLUE_CODEX_AUTH_PATH` | `~/.flue/openai-codex.json` | Auth file path used by `flue-codex-login` when `--auth-path` is not passed. This is a path, not credential material. |

### Requirements

| Requirement | Purpose |
|-------------|---------|
| `@flue/runtime` `>=1.0.0-beta.9 <2` | Peer dependency; this package must register with the host app's runtime provider registry. |
| Node `>=20` | Required runtime for the package and CLI. |
| ChatGPT/Codex subscription | Required upstream account capability for OpenAI Codex OAuth. |
| `hono` `>=4` | Optional peer used by typical Flue HTTP apps; middleware is structurally typed and does not import `hono`. |

## Typical use

```ts
// src/app.ts
import { codexAuth } from "flue-codex-oauth";
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

const codex = codexAuth({
  authPath: process.env.FLUE_CODEX_AUTH_PATH,
  forbiddenPaths: [process.cwd()],
});

await codex.configure();

const app = new Hono();

app.use("*", codex.middleware());

app.route("/", flue());

export default app;
```

Create or replace the auth file:

```bash
npx flue-codex-login --auth-path ~/.flue/openai-codex.json
npx flue-codex-login --auth-path ~/.flue/openai-codex.json --force
```

You can also hand this repo's URL to a Flue coding agent:

```bash
flue add tooling <repo-url>
```

The agent can use this README as the integration starting point.

## Security

The default posture is local-file credentials, not env-var credentials.

- Auth files are written atomically through a temporary file and rename.
- Auth files are written with owner-only `0600` permissions on POSIX systems.
- The login CLI creates the parent directory recursively and chmods it to `0700`.
- The default runtime guard rejects auth files inside `process.cwd()`.
- Refresh tokens are persisted only in the auth file and are not returned by `resolveApiKey()`.
- Token values are never logged by this package.

Env hygiene is enabled by default. These names must not contain real Codex OAuth material:

- `OPENAI_CODEX_AUTH_JSON`
- `OPENAI_CODEX_AUTH_FILE`
- `OPENAI_CODEX_ACCESS_TOKEN`
- `OPENAI_CODEX_REFRESH_TOKEN`
- `OPENAI_CODEX_ID_TOKEN`
- `CODEX_AUTH_JSON`
- `CODEX_AUTH_FILE`
- `CODEX_ACCESS_TOKEN`
- `CODEX_REFRESH_TOKEN`

Placeholder values such as `PH_TOKEN` or strings containing `placeholder` are ignored so deployment templates can still declare shape without carrying secrets.

## Links

- [Flue documentation](https://flueframework.com/docs)
- [Flue model/provider guide](https://flueframework.com/docs/guide/models)
- [OpenAI Codex](https://openai.com/codex)
