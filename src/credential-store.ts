import { existsSync, promises as fsPromises, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { refreshOpenAICodexToken, type OAuthCredentials } from "@earendil-works/pi-ai/oauth";

const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;
const CODEX_PROVIDER_ID = "openai-codex";

export interface CodexCredentialStoreOptions {
  /** Absolute path (after ~ expansion) to the auth JSON file. */
  authPath: string;
  /** Paths the auth file must not live inside. Default: [process.cwd()]. */
  forbiddenPaths?: string[];
  /** Refresh this long before expiry. Default: 300_000 (5 min). */
  refreshSkewMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
  /** Injectable refresher, for tests. Default: refreshOpenAICodexToken. */
  refreshToken?: (refresh: string) => Promise<OAuthCredentials>;
}

export interface CodexAuthStatus {
  configured: boolean;
  authPath: string;
  accountId?: string;
  expiresAt?: string;
  lastRefresh?: string;
}

export interface AuthCheck {
  name: string;
  ok: boolean;
  severity: "error" | "warning";
  message: string;
}

interface CodexAuthFile {
  provider: typeof CODEX_PROVIDER_ID;
  credentials: OAuthCredentials;
  lastRefresh?: string;
}

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

export function validateAuthPath(options: CodexCredentialStoreOptions): AuthCheck[] {
  const authPath = clean(options.authPath);
  const expandedAuthPath = authPath ? expandHome(authPath) : undefined;
  const forbiddenPaths = options.forbiddenPaths ?? [process.cwd()];
  const resolvedForbiddenPaths = forbiddenPaths
    .map((item) => clean(item))
    .filter((item): item is string => Boolean(item))
    .map((item) => resolve(expandHome(item)));

  const checks = [
    check(
      "codex-auth-path-configured",
      Boolean(expandedAuthPath),
      "error",
      "Set a Codex auth path before using Codex subscription auth.",
    ),
    check(
      "codex-auth-path-absolute",
      Boolean(expandedAuthPath) && isAbsolute(expandedAuthPath!),
      "error",
      `Codex auth path must be absolute: ${expandedAuthPath ?? "<unset>"}`,
    ),
    check(
      "codex-auth-path-outside-forbidden",
      Boolean(expandedAuthPath) &&
        isAbsolute(expandedAuthPath!) &&
        resolvedForbiddenPaths.every(
          (forbiddenPath) => !isPathInside(forbiddenPath, resolve(expandedAuthPath!)),
        ),
      "error",
      `Codex auth path must stay outside forbidden paths: ${expandedAuthPath ?? "<unset>"}`,
    ),
  ];

  checks.push(
    check(
      "codex-auth-file-mode",
      !expandedAuthPath ||
        !isAbsolute(expandedAuthPath) ||
        codexAuthFileModeIsSafe(resolve(expandedAuthPath)),
      "error",
      `Codex auth file must be owner-only and its parent directory must not be group/world writable: ${expandedAuthPath ?? "<unset>"}`,
    ),
  );

  return checks;
}

export function readAuthStatus(options: CodexCredentialStoreOptions): CodexAuthStatus {
  const authPath = clean(options.authPath);
  if (!authPath) return { configured: false, authPath: "" };

  const resolvedAuthPath = resolve(expandHome(authPath));

  try {
    const authFile = readAuthFile(resolvedAuthPath);
    return statusFromAuthFile(resolvedAuthPath, authFile);
  } catch {
    return {
      configured: existsSync(resolvedAuthPath),
      authPath: resolvedAuthPath,
    };
  }
}

export async function resolveApiKey(
  options: CodexCredentialStoreOptions,
): Promise<{ apiKey: string; status: CodexAuthStatus }> {
  assertAuthPath(options);

  const authPath = resolve(expandHome(options.authPath));
  const authFile = readAuthFile(authPath);
  const now = options.now?.() ?? Date.now();
  const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  let credentials = authFile.credentials;
  let lastRefresh = authFile.lastRefresh;

  if (now >= credentials.expires - refreshSkewMs) {
    const refreshToken = options.refreshToken ?? refreshOpenAICodexToken;
    credentials = await refreshToken(credentials.refresh);
    validateCredentials(credentials, authPath);
    lastRefresh = new Date(now).toISOString();
    await writeAuthFileAtomic(authPath, {
      provider: CODEX_PROVIDER_ID,
      credentials,
      lastRefresh,
    });
  }

  return {
    apiKey: credentials.access,
    status: statusFromAuthFile(authPath, {
      provider: CODEX_PROVIDER_ID,
      credentials,
      lastRefresh,
    }),
  };
}

export async function writeAuthFileAtomic(
  authPath: string,
  authFile: {
    provider: "openai-codex";
    credentials: OAuthCredentials;
    lastRefresh?: string;
  },
): Promise<void> {
  const dir = dirname(authPath);
  const tempPath = resolve(dir, `.openai-codex.${process.pid}.${Date.now()}.tmp`);
  const payload = `${JSON.stringify(authFile, null, 2)}\n`;

  try {
    await fsPromises.writeFile(tempPath, payload, { mode: 0o600, flag: "wx" });
    await fsPromises.chmod(tempPath, 0o600);
    await fsPromises.rename(tempPath, authPath);
  } catch (error) {
    await fsPromises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function assertAuthPath(options: CodexCredentialStoreOptions): void {
  const failed = validateAuthPath(options).filter(
    (item) => !item.ok && item.severity === "error",
  );
  if (failed.length > 0) {
    throw new Error(
      `Codex subscription auth is not safe to use:\n${failed.map((item) => `- ${item.name}: ${item.message}`).join("\n")}`,
    );
  }
}

function readAuthFile(authPath: string): CodexAuthFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(authPath, "utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read Codex auth file ${authPath}: ${detail}`, {
      cause: error,
    });
  }

  if (!isObject(parsed))
    throw new Error(`Invalid Codex auth file ${authPath}: top-level value must be an object`);
  if (parsed.provider !== CODEX_PROVIDER_ID)
    throw new Error(`Invalid Codex auth file ${authPath}: provider must be ${CODEX_PROVIDER_ID}`);
  if (!isObject(parsed.credentials))
    throw new Error(`Invalid Codex auth file ${authPath}: credentials must be an object`);

  validateCredentials(parsed.credentials, authPath);

  const lastRefresh = parsed.lastRefresh;
  if (lastRefresh !== undefined && typeof lastRefresh !== "string") {
    throw new Error(
      `Invalid Codex auth file ${authPath}: lastRefresh must be a string when present`,
    );
  }

  return {
    provider: CODEX_PROVIDER_ID,
    credentials: parsed.credentials,
    ...(lastRefresh ? { lastRefresh } : {}),
  };
}

function validateCredentials(
  value: Record<string, unknown>,
  authPath: string,
): asserts value is OAuthCredentials {
  if (typeof value.access !== "string" || value.access.length === 0) {
    throw new Error(
      `Invalid Codex auth file ${authPath}: credentials.access must be a non-empty string`,
    );
  }
  if (typeof value.refresh !== "string" || value.refresh.length === 0) {
    throw new Error(
      `Invalid Codex auth file ${authPath}: credentials.refresh must be a non-empty string`,
    );
  }
  if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) {
    throw new Error(
      `Invalid Codex auth file ${authPath}: credentials.expires must be a finite number`,
    );
  }
}

function statusFromAuthFile(authPath: string, authFile: CodexAuthFile): CodexAuthStatus {
  const accountId = authFile.credentials.accountId;

  return {
    configured: true,
    authPath,
    ...(typeof accountId === "string" && accountId ? { accountId } : {}),
    expiresAt: new Date(authFile.credentials.expires).toISOString(),
    ...(authFile.lastRefresh ? { lastRefresh: authFile.lastRefresh } : {}),
  };
}

function codexAuthFileModeIsSafe(authPath: string): boolean {
  if (process.platform === "win32" || !existsSync(authPath)) return true;

  try {
    const fileStat = statSync(authPath);
    const parentStat = statSync(dirname(authPath));
    return (fileStat.mode & 0o077) === 0 && (parentStat.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return (
    relativePath === "" ||
    (!!relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function check(
  name: string,
  ok: boolean,
  severity: "error" | "warning",
  message: string,
): AuthCheck {
  return { name, ok, severity, message };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
