import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import { codexAuth } from "../src/codex-auth.ts";

describe("codexAuth", () => {
  it("registers the stored access token for a valid auth file", async () => {
    const authPath = authFilePath();
    const registerProvider = vi.fn();
    writeAuthFile(authPath, Date.now() + 600_000);

    const status = await codexAuth({ authPath, registerProvider }).configure();

    expect(registerProvider).toHaveBeenCalledTimes(1);
    expect(registerProvider).toHaveBeenCalledWith("openai-codex", { apiKey: "test-access" });
    expect(status.configured).toBe(true);
  });

  it("refreshes stale credentials before registering", async () => {
    const authPath = authFilePath();
    const registerProvider = vi.fn();
    const now = Date.now();
    const refreshedCredentials = {
      access: "refreshed-access",
      refresh: "refreshed-refresh",
      expires: now + 3_600_000,
      accountId: "acct_ready_test",
    };
    writeAuthFile(authPath, now - 1_000);

    await codexAuth({
      authPath,
      registerProvider,
      now: () => now,
      refreshToken: async () => refreshedCredentials,
    }).configure();
    const persisted = JSON.parse(readFileSync(authPath, "utf8")) as {
      credentials: OAuthCredentials;
    };

    expect(registerProvider).toHaveBeenCalledWith("openai-codex", {
      apiKey: refreshedCredentials.access,
    });
    expect(persisted.credentials).toEqual(refreshedCredentials);
  });

  it("aggregates path and env hygiene failures before registering", async () => {
    const forbiddenRoot = mkdtempSync(join(tmpdir(), "codex-auth-forbidden-"));
    const authPath = join(forbiddenRoot, "openai-codex.json");
    const registerProvider = vi.fn();

    await expect(
      codexAuth({
        authPath,
        forbiddenPaths: [forbiddenRoot],
        env: { CODEX_REFRESH_TOKEN: "real-refresh-token" },
        registerProvider,
      }).configure(),
    ).rejects.toThrow(/codex-auth-path-outside-forbidden[\s\S]*codex-no-env-credentials/);
    expect(registerProvider).not.toHaveBeenCalled();
  });

  it("can disable env hygiene checks", async () => {
    const authPath = authFilePath();
    const registerProvider = vi.fn();
    writeAuthFile(authPath, Date.now() + 600_000);

    await codexAuth({
      authPath,
      env: { CODEX_REFRESH_TOKEN: "real-refresh-token" },
      envHygiene: false,
      registerProvider,
    }).configure();

    expect(registerProvider).toHaveBeenCalledWith("openai-codex", { apiKey: "test-access" });
  });

  it("middleware configures before next and skips next when configure fails", async () => {
    const authPath = authFilePath();
    const next = vi.fn(async () => {});
    writeAuthFile(authPath, Date.now() + 600_000);

    await codexAuth({ authPath, registerProvider: vi.fn() }).middleware()({}, next);
    expect(next).toHaveBeenCalledTimes(1);

    const forbiddenRoot = mkdtempSync(join(tmpdir(), "codex-auth-forbidden-"));
    const failingNext = vi.fn(async () => {});
    await expect(
      codexAuth({
        authPath: join(forbiddenRoot, "openai-codex.json"),
        forbiddenPaths: [forbiddenRoot],
        registerProvider: vi.fn(),
      }).middleware()({}, failingNext),
    ).rejects.toThrow("codex-auth-path-outside-forbidden");
    expect(failingNext).not.toHaveBeenCalled();
  });

  it("shares one in-flight refresh across concurrent middleware invocations", async () => {
    const authPath = authFilePath();
    const registerProvider = vi.fn();
    const now = Date.now();
    const refreshedCredentials = {
      access: "single-flight-access",
      refresh: "single-flight-refresh",
      expires: now + 3_600_000,
      accountId: "acct_ready_test",
    };
    let resolveRefresh!: (credentials: OAuthCredentials) => void;
    const refreshReady = new Promise<OAuthCredentials>((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshToken = vi.fn(async () => refreshReady);
    const next = vi.fn(async () => {});
    writeAuthFile(authPath, now - 1_000);

    const auth = codexAuth({
      authPath,
      registerProvider,
      now: () => now,
      refreshToken,
    });
    const middleware = auth.middleware();
    const calls = Array.from({ length: 5 }, () => middleware({}, next));
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledTimes(1));
    resolveRefresh(refreshedCredentials);
    await Promise.all(calls);

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(registerProvider).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(5);
  });

  it("throws a clear error when registerProvider is unavailable", async () => {
    const authPath = authFilePath();
    writeAuthFile(authPath, Date.now() + 600_000);

    const auth = codexAuth({
      authPath,
      registerProvider: "not-a-function" as never,
    });

    expect(auth.checks()).toContainEqual(
      expect.objectContaining({ name: "flue-runtime-integration", ok: false }),
    );
    await expect(auth.configure()).rejects.toThrow(
      "@flue/runtime registerProvider is unavailable — is @flue/runtime installed as a peer?",
    );
  });
});

function authFilePath(): string {
  return join(mkdtempSync(join(tmpdir(), "codex-auth-store-")), "openai-codex.json");
}

function writeAuthFile(path: string, expires: number): void {
  writeFileSync(
    path,
    JSON.stringify({
      provider: "openai-codex",
      credentials: credentials(expires),
    }),
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
}

function credentials(expires: number): OAuthCredentials {
  return {
    access: "test-access",
    refresh: "test-refresh",
    expires,
    accountId: "acct_ready_test",
  };
}
