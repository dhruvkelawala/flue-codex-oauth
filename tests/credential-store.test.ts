import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  readAuthStatus,
  resolveApiKey,
  validateAuthPath,
  writeAuthFileAtomic,
  type CodexOAuthCredentials,
} from "../src/codex-credential-store.ts";
import { expandHome } from "../src/credential-store.ts";
import { testCredentials, writeAuthFile } from "./auth-fixture.ts";

describe("credential store", () => {
  it("returns stored access credentials without refreshing when fresh", async () => {
    const authPath = authFilePath();
    const now = Date.now();
    writeAuthFile(authPath, now + 60_000);
    const refreshCredentials = vi.fn(async () => {
      throw new Error("refresh should not be called");
    });

    const result = await resolveApiKey({
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
    const refreshedCredentials = testCredentials(now + 3_600_000, "refreshed-access");
    let releaseRefresh!: (value: CodexOAuthCredentials) => void;
    const refreshReady = new Promise<CodexOAuthCredentials>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshCredentials = vi.fn(async () => refreshReady);
    writeAuthFile(authPath, now - 1_000);

    const calls = Array.from({ length: 5 }, () =>
      resolveApiKey({ authPath, now: () => now, refreshCredentials }),
    );
    await vi.waitFor(() => expect(refreshCredentials).toHaveBeenCalledTimes(1));
    releaseRefresh(refreshedCredentials);
    const results = await Promise.all(calls);

    expect(refreshCredentials).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.apiKey)).toEqual(
      Array.from({ length: 5 }, () => "refreshed-access"),
    );
    expect(JSON.parse(readFileSync(authPath, "utf8")).credentials).toEqual(
      refreshedCredentials,
    );
  });

  it("rejects lexical and canonical paths inside forbidden paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-auth-canonical-"));
    const forbiddenRoot = join(root, "forbidden");
    const linkedRoot = join(root, "linked");
    mkdirSync(forbiddenRoot, { mode: 0o700 });
    symlinkSync(forbiddenRoot, linkedRoot);
    const authPath = join(linkedRoot, "openai-codex.json");

    expect(validateAuthPath({ authPath, forbiddenPaths: [forbiddenRoot] })).toContainEqual(
      expect.objectContaining({ name: "codex-auth-path-outside-forbidden", ok: false }),
    );
    await expect(resolveApiKey({ authPath, forbiddenPaths: [forbiddenRoot] })).rejects.toThrow(
      "codex-auth-path-outside-forbidden",
    );
  });

  it("revalidates the auth path after an asynchronous refresh", async () => {
    const authPath = authFilePath();
    const symlinkTarget = authFilePath();
    const now = Date.now();
    writeAuthFile(authPath, now - 1_000);
    writeAuthFile(symlinkTarget, now + 3_600_000);

    await expect(
      resolveApiKey({
        authPath,
        forbiddenPaths: [],
        now: () => now,
        refreshCredentials: async () => {
          unlinkSync(authPath);
          symlinkSync(symlinkTarget, authPath);
          return testCredentials(now + 3_600_000, "refreshed-access");
        },
      }),
    ).rejects.toThrow("codex-auth-path-not-a-symlink");
  });

  it("rejects symlink auth files", () => {
    const realPath = authFilePath();
    const symlinkPath = join(mkdtempSync(join(tmpdir(), "codex-auth-link-")), "auth.json");
    writeAuthFile(realPath, Date.now() + 60_000);
    symlinkSync(realPath, symlinkPath);

    expect(validateAuthPath({ authPath: symlinkPath, forbiddenPaths: [] })).toContainEqual(
      expect.objectContaining({ name: "codex-auth-path-not-a-symlink", ok: false }),
    );
  });

  it.each(["-wal", "-shm"])("rejects SQLite %s sidecar paths", (suffix) => {
    const root = mkdtempSync(join(tmpdir(), "codex-auth-sqlite-"));
    const sqlitePath = join(root, "state.sqlite");
    const authPath = `${sqlitePath}${suffix}`;

    expect(validateAuthPath({ authPath, forbiddenPaths: [sqlitePath] })).toContainEqual(
      expect.objectContaining({ name: "codex-auth-path-outside-forbidden", ok: false }),
    );
  });

  it.skipIf(process.platform === "win32")("rejects non-owner-only file and parent modes", () => {
    const authPath = authFilePath();
    writeAuthFile(authPath, Date.now() + 60_000);
    chmodSync(authPath, 0o644);
    expect(validateAuthPath({ authPath, forbiddenPaths: [] })).toContainEqual(
      expect.objectContaining({ name: "codex-auth-file-mode", ok: false }),
    );

    chmodSync(authPath, 0o600);
    chmodSync(join(authPath, ".."), 0o750);
    expect(validateAuthPath({ authPath, forbiddenPaths: [] })).toContainEqual(
      expect.objectContaining({ name: "codex-auth-file-mode", ok: false }),
    );
  });

  it("does not leak malformed JSON or upstream refresh errors", async () => {
    const authPath = authFilePath();
    const jsonSecret = "secret-in-invalid-json";
    writeFileSync(authPath, `{\"token\":\"${jsonSecret}\"`, { mode: 0o600 });
    const parseError = await resolveApiKey({ authPath, forbiddenPaths: [] }).catch(
      (error: unknown) => error as Error,
    );
    expect(parseError.message).toBe("Invalid Codex auth file: not valid JSON.");
    expect(parseError.message).not.toContain(jsonSecret);

    const refreshSecret = "secret-in-refresh-error";
    writeAuthFile(authPath, Date.now() - 1_000);
    const refreshError = await resolveApiKey({
      authPath,
      forbiddenPaths: [],
      refreshCredentials: async () => {
        throw new Error(refreshSecret);
      },
    }).catch((error: unknown) => error as Error);
    expect(refreshError.message).toBe("Codex subscription token refresh failed.");
    expect(refreshError.message).not.toContain(refreshSecret);
  });

  it("returns safe status for malformed and missing files", () => {
    const malformedPath = authFilePath();
    writeJsonFile(malformedPath, "not an auth object");
    expect(readAuthStatus({ authPath: malformedPath })).toEqual({
      configured: true,
      authPath: malformedPath,
    });

    const missingPath = join(mkdtempSync(join(tmpdir(), "codex-auth-missing-")), "missing.json");
    expect(readAuthStatus({ authPath: missingPath })).toEqual({
      configured: false,
      authPath: missingPath,
    });
  });

  it("writes atomically with owner-only mode and no leftover temp files", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-auth-write-"));
    const authPath = join(root, "openai-codex.json");

    await writeAuthFileAtomic(authPath, {
      provider: "openai-codex",
      credentials: testCredentials(Date.now() + 60_000),
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

function writeJsonFile(path: string, payload: unknown): void {
  writeFileSync(path, JSON.stringify(payload), { mode: 0o600 });
  chmodSync(path, 0o600);
}
