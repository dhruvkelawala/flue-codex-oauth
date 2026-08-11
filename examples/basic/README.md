# Basic Flue 2 Codex OAuth Example

This app registers the package's Pi provider with Flue 2 and mounts one agent.

```bash
pnpm install
pnpm login
pnpm dev
```

The auth file lives at `~/.flue/openai-codex.json` by default. It stays outside
the project, uses owner-only POSIX permissions, and is resolved and refreshed
on every model request.

The integration in `src/app.ts` is intentionally small:

```ts
setProvider(codexProvider());
app.route("/agents/assistant", createAgentRouter(assistant));
```

The agent uses `openai-codex/gpt-5.5`. Run `pnpm build` for a Node target build,
or run `pnpm -C examples/basic typecheck` from the package root to verify the
public package API.
