import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  codexProvider,
  codexProviderChecks,
  preflight,
} from "../src/codex-provider.ts";
import { createAuthFilePath, writeAuthFile } from "./auth-fixture.ts";

const authContext = {
  env: vi.fn(async () => undefined),
  fileExists: vi.fn(async () => false),
};

describe("codexProvider", () => {
  it("returns a Pi provider whose auth resolves from the file per request", async () => {
    const authPath = createAuthFilePath();
    writeAuthFile(authPath, Date.now() + 600_000);

    const provider = codexProvider({ authPath, forbiddenPaths: [] });
    const resolveAuth = provider.auth.apiKey?.resolve;

    expect(provider.id).toBe("openai-codex");
    expect(provider.getModels().length).toBeGreaterThan(0);
    await expect(resolveAuth?.({ ctx: authContext })).resolves.toEqual({
      auth: { apiKey: "test-access" },
      source: authPath,
    });

    writeAuthFile(authPath, Date.now() + 600_000, "changed-access");
    await expect(resolveAuth?.({ ctx: authContext })).resolves.toEqual({
      auth: { apiKey: "changed-access" },
      source: authPath,
    });
  });

  it("reports a normalized source path", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-provider-source-"));
    const authPath = `${root}/nested/../openai-codex.json`;
    const normalizedAuthPath = resolve(authPath);
    writeAuthFile(normalizedAuthPath, Date.now() + 600_000);

    const provider = codexProvider({ authPath, forbiddenPaths: [] });

    await expect(provider.auth.apiKey?.resolve({ ctx: authContext })).resolves.toEqual({
      auth: { apiKey: "test-access" },
      source: normalizedAuthPath,
    });
  });

  it("preflights once and returns only safe status fields", async () => {
    const authPath = createAuthFilePath();
    const expires = Date.now() + 600_000;
    writeAuthFile(authPath, expires);

    const status = await preflight({ authPath, forbiddenPaths: [] });

    expect(status).toEqual({
      authPath,
      expiresAt: new Date(expires).toISOString(),
      accountId: "acct_ready_test",
    });
    expect(JSON.stringify(status)).not.toContain("test-access");
    expect(JSON.stringify(status)).not.toContain("test-refresh");
  });

  it("rejects relative auth paths instead of resolving them against cwd", () => {
    expect(() =>
      codexProvider({ authPath: "openai-codex.json", forbiddenPaths: [] }),
    ).toThrow("codex-auth-path-absolute");
  });

  it("reports path and environment hygiene failures", () => {
    const forbiddenRoot = mkdtempSync(join(tmpdir(), "codex-auth-forbidden-"));
    const authPath = join(forbiddenRoot, "openai-codex.json");
    const options = { authPath, forbiddenPaths: [forbiddenRoot] };
    const env = { CODEX_REFRESH_TOKEN: "real-refresh-token" };

    expect(codexProviderChecks(options, env)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "codex-auth-path-outside-forbidden", ok: false }),
        expect.objectContaining({ name: "codex-no-env-credentials", ok: false }),
      ]),
    );
    expect(() => codexProvider(options)).toThrow("codex-auth-path-outside-forbidden");
  });

  it("always enforces environment hygiene", () => {
    const authPath = createAuthFilePath();
    writeAuthFile(authPath, Date.now() + 600_000);
    vi.stubEnv("CODEX_REFRESH_TOKEN", "real-refresh-token");

    try {
      expect(() => codexProvider({ authPath, forbiddenPaths: [] })).toThrow(
        "codex-no-env-credentials",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
