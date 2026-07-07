# flue-codex-oauth

> Codex subscription OAuth for [Flue](https://flueframework.com) agents.

Adds OpenAI Codex subscription authentication to a Flue application: a file-based
credential store (never env vars, never the repo), automatic token refresh with a
configurable skew, and one-line registration of the `openai-codex` model provider.

**Status: skeleton — not yet implemented.** See `docs/plans/` for the implementation plan.

## Intended usage

```ts
// src/app.ts
import { codexAuth } from "flue-codex-oauth";
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

const codex = codexAuth({ authPath: "~/.flue/openai-codex.json" });
await codex.configure(); // read auth file, refresh if stale, registerProvider("openai-codex", ...)

const app = new Hono();
app.use("*", codex.middleware()); // per-request refresh
app.route("/", flue());
export default app;
```

```bash
npx flue-codex-login   # one-time device-code login; writes the auth file with mode 0600
```

## Design principles

- **Model auth is not secret-zero.** OAuth material lives in a single local file
  outside the project, with 0600 permissions and atomic writes. Env-var forms of
  the credentials are rejected, not read.
- **Peer-depend on `@flue/runtime`.** Provider registries are module-scoped;
  the package must call the host application's `registerProvider`, never a
  bundled second copy.
- **Options object, no config framework.** Host apps read their own config and
  pass plain options.
