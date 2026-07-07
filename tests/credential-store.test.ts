import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import {
  expandHome,
  readAuthStatus,
  resolveApiKey,
  validateAuthPath,
  writeAuthFileAtomic,
} from "../src/credential-store.ts";

describe("credential store", () => {
  it("returns stored access credentials without refreshing when not stale", async () => {
    const authPath = authFilePath();
    const now = Date.now();
    writeAuthFile(authPath, now + 60_000);
    const refreshToken = vi.fn(async () => {
      throw new Error("refresh should not be called");
    });

    const result = await resolveApiKey({
      authPath,
      refreshSkewMs: 0,
      now: () => now,
      refreshToken,
    });

    expect(result.apiKey).toBe("test-access");
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it("refreshes stale credentials and persists the refreshed file", async () => {
    const authPath = authFilePath();
    const now = Date.now();
    const refreshedCredentials = {
      access: "refreshed-access",
      refresh: "refreshed-refresh",
      expires: now + 3_600_000,
      accountId: "acct_ready_test",
    };
    writeAuthFile(authPath, now - 1_000);

    const result = await resolveApiKey({
      authPath,
      now: () => now,
      refreshToken: async () => refreshedCredentials,
    });
    const persisted = JSON.parse(readFileSync(authPath, "utf8")) as {
      credentials: OAuthCredentials;
      lastRefresh?: string;
    };

    expect(result.apiKey).toBe(refreshedCredentials.access);
    expect(result.status.accountId).toBe("acct_ready_test");
    expect(result.status.lastRefresh).toBe(new Date(now).toISOString());
    expect(persisted.credentials).toEqual(refreshedCredentials);
    expect(persisted.lastRefresh).toBe(new Date(now).toISOString());
    expect(JSON.stringify(result)).not.toContain(refreshedCredentials.refresh);
  });

  it("rejects auth paths inside explicitly forbidden paths", async () => {
    const forbiddenRoot = mkdtempSync(join(tmpdir(), "codex-auth-forbidden-"));
    const authPath = join(forbiddenRoot, "openai-codex.json");
    const checks = validateAuthPath({ authPath, forbiddenPaths: [forbiddenRoot] });

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "codex-auth-path-outside-forbidden",
        ok: false,
        severity: "error",
      }),
    );
    await expect(resolveApiKey({ authPath, forbiddenPaths: [forbiddenRoot] })).rejects.toThrow(
      "codex-auth-path-outside-forbidden",
    );
  });

  it("rejects auth paths inside process.cwd() by default", async () => {
    const authPath = join(process.cwd(), "openai-codex.json");
    const checks = validateAuthPath({ authPath });

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "codex-auth-path-outside-forbidden",
        ok: false,
        severity: "error",
      }),
    );
    await expect(resolveApiKey({ authPath })).rejects.toThrow(
      "codex-auth-path-outside-forbidden",
    );
  });

  it("rejects relative auth paths", () => {
    const checks = validateAuthPath({ authPath: "openai-codex.json", forbiddenPaths: [] });

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "codex-auth-path-absolute",
        ok: false,
        severity: "error",
      }),
    );
  });

  it.skipIf(process.platform === "win32")("rejects unsafe auth file modes", () => {
    const authPath = authFilePath();
    writeAuthFile(authPath, Date.now() + 60_000);
    chmodSync(authPath, 0o644);

    expect(validateAuthPath({ authPath, forbiddenPaths: [] })).toContainEqual(
      expect.objectContaining({
        name: "codex-auth-file-mode",
        ok: false,
        severity: "error",
      }),
    );
  });

  it.each([
    ["wrong provider", { provider: "other", credentials: credentials(Date.now() + 60_000) }],
    [
      "missing access",
      {
        provider: "openai-codex",
        credentials: { refresh: "test-refresh", expires: Date.now() + 60_000 },
      },
    ],
    ["non-object top level", "not an auth object"],
  ])("throws path-qualified parse errors for %s", async (_name, payload) => {
    const authPath = authFilePath();
    writeJsonFile(authPath, payload);

    await expect(resolveApiKey({ authPath, forbiddenPaths: [] })).rejects.toThrow(authPath);
    await expect(resolveApiKey({ authPath, forbiddenPaths: [] })).rejects.toThrow(
      "Invalid Codex auth file",
    );
  });

  it("returns configured status for malformed files without throwing", () => {
    const authPath = authFilePath();
    writeJsonFile(authPath, "not an auth object");

    expect(readAuthStatus({ authPath })).toEqual({ configured: true, authPath });
  });

  it("returns unconfigured status for missing files without throwing", () => {
    const authPath = join(mkdtempSync(join(tmpdir(), "codex-auth-missing-")), "missing.json");

    expect(readAuthStatus({ authPath })).toEqual({ configured: false, authPath });
  });

  it("writes auth files atomically without leaving temp files", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-auth-write-"));
    const authPath = join(root, "openai-codex.json");

    await writeAuthFileAtomic(authPath, {
      provider: "openai-codex",
      credentials: credentials(Date.now() + 60_000),
      lastRefresh: new Date(0).toISOString(),
    });

    expect(readdirSync(root).filter((item) => item.endsWith(".tmp"))).toEqual([]);
    if (process.platform !== "win32") {
      expect(statSync(authPath).mode & 0o777).toBe(0o600);
    }
  });

  it("expands home-directory shorthands", () => {
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("~/x")).toBe(join(homedir(), "x"));
    expect(expandHome("/abs")).toBe("/abs");
  });
});

function authFilePath(): string {
  return join(mkdtempSync(join(tmpdir(), "codex-auth-store-")), "openai-codex.json");
}

function writeAuthFile(path: string, expires: number): void {
  writeJsonFile(path, {
    provider: "openai-codex",
    credentials: credentials(expires),
  });
}

function writeJsonFile(path: string, payload: unknown): void {
  writeFileSync(path, JSON.stringify(payload), { mode: 0o600 });
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
