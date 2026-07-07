# Basic Flue Codex OAuth Example

This is a minimal Node-target Flue app using `flue-codex-oauth` through the package's public API.

## Run

Install dependencies:

```bash
pnpm install
```

Create the Codex auth file once with the device-code flow:

```bash
pnpm login
```

The auth file lives at `~/.flue/openai-codex.json` by default. It is outside this project, written with owner-only permissions on POSIX systems, and refreshed by the app at startup and per request.

Start the app:

```bash
pnpm dev
```

The example includes one agent at `src/agents/assistant.ts` using:

```ts
model: "openai-codex/gpt-5.5"
```

Send prompts using the Flue CLI flow from the Flue quickstart or `flue docs read cli/run`.

## Build

```bash
pnpm build
```

`pnpm build` runs `flue build --target node` and produces the Node artifact under `dist/`.

## Verification

The package root gates this example with:

```bash
pnpm -C examples/basic install
pnpm -C examples/basic typecheck
```

That typecheck uses the parent package through `flue-codex-oauth: "file:../.."`, so it exercises the built package exports instead of relative source imports.
