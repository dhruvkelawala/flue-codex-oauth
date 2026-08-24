import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  readClaudeAuthStatus,
  resolveClaudeApiKey,
  validateClaudeAuthPath,
  writeClaudeAuthFileAtomic,
} from "../src/claude-credential-store.ts";
import type { OAuthFileCredentials } from "../src/credential-store.ts";
import { claudeTestCredentials, writeClaudeAuthFile } from "./auth-fixture.ts";

describe("claude credential store", () => {
  it("returns stored access credentials without refreshing when fresh", async () => {
    const authPath = authFilePath();
    const now = Date.now();
    writeClaudeAuthFile(authPath, now + 60_000);
    const refreshCredentials = vi.fn(async () => {
      throw new Error("refresh should not be called");
    });

    const result = await resolveClaudeApiKey({
      authPath,
      refreshSkewMs: 0,
      now: () => now,
      refreshCredentials,
    });

    expect(result.apiKey).toBe("test-access");
    expect(refreshCredentials).not.toHaveBeenCalled();
  });

  it("serializes refreshes per path and re-reads under the lock", async () => {
    const authPath = authFilePath();
    const now = Date.now();
    const refreshedCredentials = claudeTestCredentials(now + 3_600_000, "refreshed-access");
    let releaseRefresh!: (value: OAuthFileCredentials) => void;
    const refreshReady = new Promise<OAuthFileCredentials>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshCredentials = vi.fn(async () => refreshReady);
    writeClaudeAuthFile(authPath, now - 1_000);

    const calls = Array.from({ length: 5 }, () =>
      resolveClaudeApiKey({ authPath, now: () => now, refreshCredentials }),
    );
    await vi.waitFor(() => expect(refreshCredentials).toHaveBeenCalledTimes(1));
    releaseRefresh(refreshedCredentials);
    const results = await Promise.all(calls);

    expect(refreshCredentials).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.apiKey)).toEqual(
      Array.from({ length: 5 }, () => "refreshed-access"),
    );
    expect(JSON.parse(readFileSync(authPath, "utf8"))).toMatchObject({
      provider: "anthropic",
      credentials: refreshedCredentials,
    });
  });

  it("uses claude-prefixed check names", () => {
    expect(validateClaudeAuthPath({ authPath: "relative.json", forbiddenPaths: [] })).toContainEqual(
      expect.objectContaining({ name: "claude-auth-path-absolute", ok: false }),
    );
  });

  it("does not leak malformed JSON or upstream refresh errors", async () => {
    const authPath = authFilePath();
    const jsonSecret = "secret-in-invalid-json";
    writeFileSync(authPath, `{"token":"${jsonSecret}"`, { mode: 0o600 });
    const parseError = await resolveClaudeApiKey({ authPath, forbiddenPaths: [] }).catch(
      (error: unknown) => error as Error,
    );
    expect(parseError.message).toBe("Invalid Claude auth file: not valid JSON.");
    expect(parseError.message).not.toContain(jsonSecret);

    const refreshSecret = "secret-in-refresh-error";
    writeClaudeAuthFile(authPath, Date.now() - 1_000);
    const refreshError = await resolveClaudeApiKey({
      authPath,
      forbiddenPaths: [],
      refreshCredentials: async () => {
        throw new Error(refreshSecret);
      },
    }).catch((error: unknown) => error as Error);
    expect(refreshError.message).toBe("Claude subscription token refresh failed.");
    expect(refreshError.message).not.toContain(refreshSecret);
  });

  it("returns safe status for malformed and missing files", () => {
    const malformedPath = authFilePath();
    writeFileSync(malformedPath, JSON.stringify("not an auth object"), { mode: 0o600 });
    expect(readClaudeAuthStatus({ authPath: malformedPath })).toEqual({
      configured: true,
      authPath: malformedPath,
    });

    const missingPath = join(mkdtempSync(join(tmpdir(), "claude-auth-missing-")), "missing.json");
    expect(readClaudeAuthStatus({ authPath: missingPath })).toEqual({
      configured: false,
      authPath: missingPath,
    });
  });

  it("writes atomically with owner-only mode and no leftover temp files", async () => {
    const root = mkdtempSync(join(tmpdir(), "claude-auth-write-"));
    const authPath = join(root, "anthropic.json");

    await writeClaudeAuthFileAtomic(authPath, {
      provider: "anthropic",
      credentials: claudeTestCredentials(Date.now() + 60_000),
      lastRefresh: new Date(0).toISOString(),
    });

    expect(readdirSync(root).filter((item) => item.endsWith(".tmp"))).toEqual([]);
    expect(JSON.parse(readFileSync(authPath, "utf8")).provider).toBe("anthropic");
    if (process.platform !== "win32") {
      expect(statSync(authPath).mode & 0o777).toBe(0o600);
    }
  });
});

function authFilePath(): string {
  return join(mkdtempSync(join(tmpdir(), "claude-auth-store-")), "anthropic.json");
}
