import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_AUTH_ENV_NAMES } from "../src/env-hygiene.ts";
import {
  claudePreflight,
  claudeProvider,
  claudeProviderChecks,
} from "../src/claude-provider.ts";
import { createClaudeAuthFilePath, writeClaudeAuthFile } from "./auth-fixture.ts";

const authContext = {
  env: vi.fn(async () => undefined),
  fileExists: vi.fn(async () => false),
};

describe("claudeProvider", () => {
  // The host shell may legitimately carry Claude OAuth material; these tests
  // must not depend on it.
  beforeEach(() => {
    for (const name of CLAUDE_AUTH_ENV_NAMES) vi.stubEnv(name, "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns a Pi provider whose auth resolves from the file per request", async () => {
    const authPath = createClaudeAuthFilePath();
    writeClaudeAuthFile(authPath, Date.now() + 600_000);

    const provider = claudeProvider({ authPath, forbiddenPaths: [] });
    const resolveAuth = provider.auth.apiKey?.resolve;

    expect(provider.id).toBe("anthropic");
    expect(provider.getModels().length).toBeGreaterThan(0);
    await expect(resolveAuth?.({ ctx: authContext })).resolves.toEqual({
      auth: { apiKey: "test-access" },
      source: authPath,
    });

    writeClaudeAuthFile(authPath, Date.now() + 600_000, "changed-access");
    await expect(resolveAuth?.({ ctx: authContext })).resolves.toEqual({
      auth: { apiKey: "changed-access" },
      source: authPath,
    });
  });

  it("reports a normalized source path", async () => {
    const root = mkdtempSync(join(tmpdir(), "claude-provider-source-"));
    const authPath = `${root}/nested/../anthropic.json`;
    const normalizedAuthPath = resolve(authPath);
    writeClaudeAuthFile(normalizedAuthPath, Date.now() + 600_000);

    const provider = claudeProvider({ authPath, forbiddenPaths: [] });

    await expect(provider.auth.apiKey?.resolve({ ctx: authContext })).resolves.toEqual({
      auth: { apiKey: "test-access" },
      source: normalizedAuthPath,
    });
  });

  it("preflights once and returns only safe status fields", async () => {
    const authPath = createClaudeAuthFilePath();
    const expires = Date.now() + 600_000;
    writeClaudeAuthFile(authPath, expires);

    const status = await claudePreflight({ authPath, forbiddenPaths: [] });

    expect(status).toEqual({
      authPath,
      expiresAt: new Date(expires).toISOString(),
    });
    expect(JSON.stringify(status)).not.toContain("test-access");
    expect(JSON.stringify(status)).not.toContain("test-refresh");
  });

  it("rejects relative auth paths instead of resolving them against cwd", () => {
    expect(() =>
      claudeProvider({ authPath: "anthropic.json", forbiddenPaths: [] }),
    ).toThrow("claude-auth-path-absolute");
  });

  it("rejects codex-flavored auth files", async () => {
    const authPath = createClaudeAuthFilePath();
    writeClaudeAuthFile(authPath, Date.now() + 600_000);
    const codexPath = join(mkdtempSync(join(tmpdir(), "claude-wrong-provider-")), "anthropic.json");
    const { writeAuthFile } = await import("./auth-fixture.ts");
    writeAuthFile(codexPath, Date.now() + 600_000);

    const provider = claudeProvider({ authPath: codexPath, forbiddenPaths: [] });
    await expect(provider.auth.apiKey?.resolve({ ctx: authContext })).rejects.toThrow(
      "Invalid Claude auth file: unexpected provider.",
    );
  });

  it("reports path and environment hygiene failures", () => {
    const forbiddenRoot = mkdtempSync(join(tmpdir(), "claude-auth-forbidden-"));
    const authPath = join(forbiddenRoot, "anthropic.json");
    const options = { authPath, forbiddenPaths: [forbiddenRoot] };
    const env = { CLAUDE_REFRESH_TOKEN: "real-refresh-token" };

    expect(claudeProviderChecks(options, env)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "claude-auth-path-outside-forbidden", ok: false }),
        expect.objectContaining({ name: "claude-no-env-credentials", ok: false }),
      ]),
    );
    expect(() => claudeProvider(options)).toThrow("claude-auth-path-outside-forbidden");
  });

  it("always enforces environment hygiene", () => {
    const authPath = createClaudeAuthFilePath();
    writeClaudeAuthFile(authPath, Date.now() + 600_000);
    vi.stubEnv("CLAUDE_REFRESH_TOKEN", "real-refresh-token");

    expect(() => claudeProvider({ authPath, forbiddenPaths: [] })).toThrow(
      "claude-no-env-credentials",
    );
  });
});
