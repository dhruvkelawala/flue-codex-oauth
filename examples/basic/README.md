# Basic Flue 2 Subscription OAuth Example

This app registers the package's Pi providers (Codex and Claude) with Flue 2
and mounts one agent per provider.

```bash
pnpm install
pnpm login          # OpenAI Codex device-code flow
pnpm login:claude   # Claude Pro/Max browser OAuth flow
pnpm dev
```

The auth files live at `~/.flue/openai-codex.json` and `~/.flue/anthropic.json`
by default. They stay outside the project, use owner-only POSIX permissions,
and are resolved and refreshed on every model request.

The integration in `src/app.ts` is intentionally small:

```ts
setProvider(codexProvider());
setProvider(claudeProvider());
app.route("/agents/assistant", createAgentRouter(Assistant));
app.route("/agents/claude-assistant", createAgentRouter(ClaudeAssistant));
```

The agents use `openai-codex/gpt-5.5` and `anthropic/claude-sonnet-4-6`. You
only need the login (and provider registration) for the provider you actually
use. Run `pnpm build` for a Node target build, or run
`pnpm -C examples/basic typecheck` from the package root to verify the public
package API.
