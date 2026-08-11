import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  codexProvider,
  codexProviderChecks,
  preflight,
} from "../src/codex-provider.ts";

const authContext = {
  env: vi.fn(async () => undefined),
  fileExists: vi.fn(async () => false),
};

describe("codexProvider", () => {
  it("returns a Pi provider whose auth resolves from the file per request", async () => {
    const authPath = authFilePath();
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

  it("refreshes stale credentials through the request-time resolver", async () => {
    const authPath = authFilePath();
    const now = Date.now();
    const refreshCredentials = vi.fn(async () => ({
      access: "refreshed-access",
      refresh: "refreshed-refresh",
      expires: now + 3_600_000,
      accountId: "acct_ready_test",
    }));
    writeAuthFile(authPath, now - 1_000);

    const provider = codexProvider({
      authPath,
      forbiddenPaths: [],
      now: () => now,
      refreshCredentials,
    });

    await expect(provider.auth.apiKey?.resolve({ ctx: authContext })).resolves.toEqual({
      auth: { apiKey: "refreshed-access" },
      source: authPath,
    });
    expect(refreshCredentials).toHaveBeenCalledTimes(1);
  });

  it("preflights once and returns only safe status fields", async () => {
    const authPath = authFilePath();
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

  it("aggregates path and env hygiene failures before creating a provider", () => {
    const forbiddenRoot = mkdtempSync(join(tmpdir(), "codex-auth-forbidden-"));
    const authPath = join(forbiddenRoot, "openai-codex.json");
    const options = {
      authPath,
      forbiddenPaths: [forbiddenRoot],
      env: { CODEX_REFRESH_TOKEN: "real-refresh-token" },
    };

    expect(codexProviderChecks(options)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "codex-auth-path-outside-forbidden", ok: false }),
        expect.objectContaining({ name: "codex-no-env-credentials", ok: false }),
      ]),
    );
    expect(() => codexProvider(options)).toThrow(
      /codex-auth-path-outside-forbidden[\s\S]*codex-no-env-credentials/,
    );
  });
});

function authFilePath(): string {
  return join(mkdtempSync(join(tmpdir(), "codex-provider-")), "openai-codex.json");
}

function writeAuthFile(path: string, expires: number, access = "test-access"): void {
  writeFileSync(
    path,
    JSON.stringify({
      provider: "openai-codex",
      credentials: {
        access,
        refresh: "test-refresh",
        expires,
        accountId: "acct_ready_test",
      },
    }),
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
}
