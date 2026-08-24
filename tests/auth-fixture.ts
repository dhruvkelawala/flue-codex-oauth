import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthFileCredentials } from "../src/credential-store.ts";

export function createAuthFilePath(): string {
  return join(mkdtempSync(join(tmpdir(), "codex-auth-test-")), "openai-codex.json");
}

export function createAuthFile(
  expires: number,
  access = "test-access",
): string {
  const authPath = createAuthFilePath();
  writeAuthFile(authPath, expires, access);
  return authPath;
}

export function writeAuthFile(
  authPath: string,
  expires: number,
  access = "test-access",
): void {
  writeFileSync(
    authPath,
    JSON.stringify({
      provider: "openai-codex",
      credentials: testCredentials(expires, access),
    }),
    { mode: 0o600 },
  );
  chmodSync(authPath, 0o600);
}

export function testCredentials(
  expires: number,
  access = "test-access",
): OAuthFileCredentials {
  return {
    access,
    refresh: "test-refresh",
    expires,
    accountId: "acct_ready_test",
  };
}

export function createClaudeAuthFilePath(): string {
  return join(mkdtempSync(join(tmpdir(), "claude-auth-test-")), "anthropic.json");
}

export function createClaudeAuthFile(
  expires: number,
  access = "test-access",
): string {
  const authPath = createClaudeAuthFilePath();
  writeClaudeAuthFile(authPath, expires, access);
  return authPath;
}

export function writeClaudeAuthFile(
  authPath: string,
  expires: number,
  access = "test-access",
): void {
  writeFileSync(
    authPath,
    JSON.stringify({
      provider: "anthropic",
      credentials: claudeTestCredentials(expires, access),
    }),
    { mode: 0o600 },
  );
  chmodSync(authPath, 0o600);
}

export function claudeTestCredentials(
  expires: number,
  access = "test-access",
): OAuthFileCredentials {
  return {
    access,
    refresh: "test-refresh",
    expires,
  };
}
