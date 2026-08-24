import {
  existsSync,
  lstatSync,
  promises as fsPromises,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { refreshCodexCredentials } from "./codex-oauth.js";

const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;
const CODEX_PROVIDER_ID = "openai-codex";

export interface CodexOAuthCredentials {
  refresh: string;
  access: string;
  expires: number;
  accountId?: string;
  [key: string]: unknown;
}

export interface CodexCredentialStoreOptions {
  /** Absolute path (after ~ expansion) to the auth JSON file. */
  authPath: string;
  /** Paths the auth file must not equal or live inside. Default: [process.cwd()]. */
  forbiddenPaths?: string[];
  /** Refresh this long before expiry. Default: 300_000 (5 min). */
  refreshSkewMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
  /** Injectable refresher, for tests. Default: Pi's openai-codex OAuth refresh. */
  refreshCredentials?: (
    credentials: CodexOAuthCredentials,
  ) => Promise<CodexOAuthCredentials>;
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

export function assertSafeChecks(checks: AuthCheck[]): void {
  const failed = checks.filter((item) => !item.ok && item.severity === "error");
  if (failed.length > 0) {
    throw new Error(
      `Codex subscription auth is not safe to use:\n${failed.map((item) => `- ${item.name}: ${item.message}`).join("\n")}`,
    );
  }
}

interface CodexAuthFile {
  provider: typeof CODEX_PROVIDER_ID;
  credentials: CodexOAuthCredentials;
  lastRefresh?: string;
}

/** In-process refresh serialization, keyed by resolved auth path. */
const refreshLocks = new Map<string, Promise<void>>();

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

export function validateAuthPath(options: CodexCredentialStoreOptions): AuthCheck[] {
  const authPath = clean(options.authPath);
  const expandedAuthPath = authPath ? expandHome(authPath) : undefined;
  const absolute = Boolean(expandedAuthPath) && isAbsolute(expandedAuthPath!);
  const lexicalAuthPath = absolute ? resolve(expandedAuthPath!) : undefined;
  const canonicalAuthPath = lexicalAuthPath ? canonicalPath(lexicalAuthPath) : undefined;
  const forbiddenPaths = (options.forbiddenPaths ?? [process.cwd()])
    .map((item) => clean(item))
    .filter((item): item is string => Boolean(item))
    .map((item) => resolve(expandHome(item)));

  const outsideForbidden =
    lexicalAuthPath !== undefined &&
    canonicalAuthPath !== undefined &&
    forbiddenPaths.every((forbiddenPath) => {
      const canonicalForbiddenPath = canonicalPath(forbiddenPath);
      return (
        !isInsideOrSqliteSidecarOf(forbiddenPath, lexicalAuthPath) &&
        !isInsideOrSqliteSidecarOf(canonicalForbiddenPath, canonicalAuthPath)
      );
    });

  return [
    check(
      "codex-auth-path-configured",
      Boolean(expandedAuthPath),
      "error",
      "Set a Codex auth path before using Codex subscription auth.",
    ),
    check(
      "codex-auth-path-absolute",
      absolute,
      "error",
      `Codex auth path must be absolute: ${expandedAuthPath ?? "<unset>"}`,
    ),
    check(
      "codex-auth-path-not-a-symlink",
      !lexicalAuthPath || !isSymlink(lexicalAuthPath),
      "error",
      `Codex auth path must not be a symlink: ${expandedAuthPath ?? "<unset>"}`,
    ),
    check(
      "codex-auth-path-outside-forbidden",
      outsideForbidden,
      "error",
      `Codex auth path must stay outside forbidden paths: ${expandedAuthPath ?? "<unset>"}`,
    ),
    check(
      "codex-auth-file-mode",
      !lexicalAuthPath || codexAuthFileModeIsSafe(lexicalAuthPath),
      "error",
      `Codex auth file and its parent directory must be owner-only: ${expandedAuthPath ?? "<unset>"}`,
    ),
  ];
}

export function readAuthStatus(options: CodexCredentialStoreOptions): CodexAuthStatus {
  const authPath = clean(options.authPath);
  if (!authPath) return { configured: false, authPath: "" };

  const resolvedAuthPath = resolve(expandHome(authPath));
  try {
    return statusFromAuthFile(resolvedAuthPath, readAuthFile(resolvedAuthPath));
  } catch {
    return { configured: existsSync(resolvedAuthPath), authPath: resolvedAuthPath };
  }
}

export async function resolveApiKey(
  options: CodexCredentialStoreOptions,
): Promise<{ apiKey: string; status: CodexAuthStatus }> {
  assertAuthPath(options);

  const authPath = resolve(expandHome(options.authPath));
  const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  let authFile = readAuthFile(authPath);
  const initialNow = options.now?.() ?? Date.now();

  if (isStale(authFile.credentials, initialNow, refreshSkewMs)) {
    const previousRefresh = refreshLocks.get(authPath) ?? Promise.resolve();
    const queuedRefresh = previousRefresh.catch(() => {}).then(async () => {
      // Revalidate under the lock because the path may have changed while waiting.
      assertAuthPath(options);
      // A prior waiter may already have exchanged the rotating refresh token.
      const latestAuthFile = readAuthFile(authPath);
      const now = options.now?.() ?? Date.now();
      if (!isStale(latestAuthFile.credentials, now, refreshSkewMs)) return;

      const refresh = options.refreshCredentials ?? refreshCodexCredentials;
      let credentials: CodexOAuthCredentials;
      try {
        credentials = await refresh(latestAuthFile.credentials);
      } catch (error) {
        throw new Error("Codex subscription token refresh failed.", { cause: error });
      }
      validateCredentials(credentials);
      // Refresh is asynchronous, so reject a symlink/path swap before atomic rename.
      assertAuthPath(options);
      await writeAuthFileAtomic(authPath, {
        provider: CODEX_PROVIDER_ID,
        credentials,
        lastRefresh: new Date(now).toISOString(),
      });
    });

    refreshLocks.set(authPath, queuedRefresh);
    try {
      await queuedRefresh;
    } finally {
      if (refreshLocks.get(authPath) === queuedRefresh) refreshLocks.delete(authPath);
    }
    authFile = readAuthFile(authPath);
  }

  return {
    apiKey: authFile.credentials.access,
    status: statusFromAuthFile(authPath, authFile),
  };
}

export async function writeAuthFileAtomic(
  authPath: string,
  authFile: CodexAuthFile,
): Promise<void> {
  const dir = dirname(authPath);
  const nonce = randomBytes(8).toString("hex");
  const tempPath = resolve(dir, `.openai-codex.${process.pid}.${Date.now()}.${nonce}.tmp`);
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
  assertSafeChecks(validateAuthPath(options));
}

function readAuthFile(authPath: string): CodexAuthFile {
  let raw: string;
  try {
    raw = readFileSync(authPath, "utf8");
  } catch (error) {
    throw new Error("Could not read Codex auth file.", { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error("Invalid Codex auth file: not valid JSON.", { cause: error });
  }

  if (!isObject(parsed))
    throw new Error("Invalid Codex auth file: top-level value must be an object.");
  if (parsed.provider !== CODEX_PROVIDER_ID)
    throw new Error("Invalid Codex auth file: unexpected provider.");
  if (!isObject(parsed.credentials))
    throw new Error("Invalid Codex auth file: credentials must be an object.");

  validateCredentials(parsed.credentials);
  if (parsed.lastRefresh !== undefined && typeof parsed.lastRefresh !== "string") {
    throw new Error("Invalid Codex auth file: lastRefresh must be a string when present.");
  }

  return {
    provider: CODEX_PROVIDER_ID,
    credentials: parsed.credentials,
    ...(parsed.lastRefresh ? { lastRefresh: parsed.lastRefresh } : {}),
  };
}

function validateCredentials(
  value: Record<string, unknown>,
): asserts value is CodexOAuthCredentials {
  if (typeof value.access !== "string" || value.access.length === 0) {
    throw new Error(
      "Invalid Codex auth file: credentials.access must be a non-empty string.",
    );
  }
  if (typeof value.refresh !== "string" || value.refresh.length === 0) {
    throw new Error(
      "Invalid Codex auth file: credentials.refresh must be a non-empty string.",
    );
  }
  if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) {
    throw new Error("Invalid Codex auth file: credentials.expires must be a finite number.");
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

function isStale(
  credentials: CodexOAuthCredentials,
  now: number,
  refreshSkewMs: number,
): boolean {
  return now >= credentials.expires - refreshSkewMs;
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    return resolve(canonicalPath(parent), relative(parent, path));
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function codexAuthFileModeIsSafe(authPath: string): boolean {
  if (process.platform === "win32") return true;

  try {
    const parentStat = statSync(dirname(authPath));
    if ((parentStat.mode & 0o077) !== 0) return false;
    if (!existsSync(authPath)) return true;
    return (statSync(authPath).mode & 0o077) === 0;
  } catch {
    return false;
  }
}

function isInsideOrSqliteSidecarOf(forbiddenPath: string, authPath: string): boolean {
  return (
    isPathInside(forbiddenPath, authPath) ||
    authPath === `${forbiddenPath}-wal` ||
    authPath === `${forbiddenPath}-shm`
  );
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
