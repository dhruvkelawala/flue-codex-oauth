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

const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface OAuthFileCredentials {
  refresh: string;
  access: string;
  expires: number;
  accountId?: string;
  [key: string]: unknown;
}

/** Provider-specific labels and defaults for one credential file family. */
export interface StoreProfile {
  /** Auth-file provider discriminator, e.g. "openai-codex". */
  providerId: string;
  /** Human label used in messages, e.g. "Codex". */
  label: string;
  /** Check-name prefix, e.g. "codex". */
  checkPrefix: string;
  /** Temp-file prefix used during atomic writes, e.g. ".openai-codex". */
  tempPrefix: string;
  /** Default refresher used when options do not inject one. */
  refreshCredentials: (
    credentials: OAuthFileCredentials,
  ) => Promise<OAuthFileCredentials>;
}

export interface CredentialStoreOptions {
  /** Absolute path (after ~ expansion) to the auth JSON file. */
  authPath: string;
  /** Paths the auth file must not equal or live inside. Default: [process.cwd()]. */
  forbiddenPaths?: string[];
  /** Refresh this long before expiry. Default: 300_000 (5 min). */
  refreshSkewMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
  /** Injectable refresher, for tests. Default: the profile's OAuth refresh. */
  refreshCredentials?: (
    credentials: OAuthFileCredentials,
  ) => Promise<OAuthFileCredentials>;
}

export interface OAuthAuthStatus {
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

export function assertSafeChecksFor(label: string, checks: AuthCheck[]): void {
  const failed = checks.filter((item) => !item.ok && item.severity === "error");
  if (failed.length > 0) {
    throw new Error(
      `${label} subscription auth is not safe to use:\n${failed.map((item) => `- ${item.name}: ${item.message}`).join("\n")}`,
    );
  }
}

export interface OAuthAuthFile {
  provider: string;
  credentials: OAuthFileCredentials;
  lastRefresh?: string;
}

export function credentialStoreFor(profile: StoreProfile) {
  return {
    validateAuthPath: (options: CredentialStoreOptions) =>
      validateAuthPathFor(profile, options),
    readAuthStatus: (options: CredentialStoreOptions) =>
      readAuthStatusFor(profile, options),
    resolveApiKey: (options: CredentialStoreOptions) =>
      resolveApiKeyFor(profile, options),
    writeAuthFileAtomic: (authPath: string, authFile: OAuthAuthFile) =>
      writeAuthFileAtomicFor(profile, authPath, authFile),
  };
}

/** In-process refresh serialization, keyed by resolved auth path. */
const refreshLocks = new Map<string, Promise<void>>();

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

export function validateAuthPathFor(
  profile: StoreProfile,
  options: CredentialStoreOptions,
): AuthCheck[] {
  const { label, checkPrefix } = profile;
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
      `${checkPrefix}-auth-path-configured`,
      Boolean(expandedAuthPath),
      "error",
      `Set a ${label} auth path before using ${label} subscription auth.`,
    ),
    check(
      `${checkPrefix}-auth-path-absolute`,
      absolute,
      "error",
      `${label} auth path must be absolute: ${expandedAuthPath ?? "<unset>"}`,
    ),
    check(
      `${checkPrefix}-auth-path-not-a-symlink`,
      !lexicalAuthPath || !isSymlink(lexicalAuthPath),
      "error",
      `${label} auth path must not be a symlink: ${expandedAuthPath ?? "<unset>"}`,
    ),
    check(
      `${checkPrefix}-auth-path-outside-forbidden`,
      outsideForbidden,
      "error",
      `${label} auth path must stay outside forbidden paths: ${expandedAuthPath ?? "<unset>"}`,
    ),
    check(
      `${checkPrefix}-auth-file-mode`,
      !lexicalAuthPath || authFileModeIsSafe(lexicalAuthPath),
      "error",
      `${label} auth file and its parent directory must be owner-only: ${expandedAuthPath ?? "<unset>"}`,
    ),
  ];
}

export function readAuthStatusFor(
  profile: StoreProfile,
  options: CredentialStoreOptions,
): OAuthAuthStatus {
  const authPath = clean(options.authPath);
  if (!authPath) return { configured: false, authPath: "" };

  const resolvedAuthPath = resolve(expandHome(authPath));
  try {
    return statusFromAuthFile(resolvedAuthPath, readAuthFile(profile, resolvedAuthPath));
  } catch {
    return { configured: existsSync(resolvedAuthPath), authPath: resolvedAuthPath };
  }
}

export async function resolveApiKeyFor(
  profile: StoreProfile,
  options: CredentialStoreOptions,
): Promise<{ apiKey: string; status: OAuthAuthStatus }> {
  assertAuthPath(profile, options);

  const authPath = resolve(expandHome(options.authPath));
  const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  let authFile = await readAuthFileAsync(profile, authPath);
  const initialNow = options.now?.() ?? Date.now();

  if (isStale(authFile.credentials, initialNow, refreshSkewMs)) {
    const previousRefresh = refreshLocks.get(authPath) ?? Promise.resolve();
    const queuedRefresh = previousRefresh.catch(() => {}).then(async () => {
      // Revalidate under the lock because the path may have changed while waiting.
      assertAuthPath(profile, options);
      // A prior waiter may already have exchanged the rotating refresh token.
      const latestAuthFile = await readAuthFileAsync(profile, authPath);
      const now = options.now?.() ?? Date.now();
      if (!isStale(latestAuthFile.credentials, now, refreshSkewMs)) return;

      const refresh = options.refreshCredentials ?? profile.refreshCredentials;
      let credentials: OAuthFileCredentials;
      try {
        credentials = await refresh(latestAuthFile.credentials);
      } catch {
        throw new Error(`${profile.label} subscription token refresh failed.`);
      }
      validateCredentials(profile, credentials);
      // Refresh is asynchronous, so reject a symlink/path swap before atomic rename.
      assertAuthPath(profile, options);
      await writeAuthFileAtomicFor(profile, authPath, {
        provider: profile.providerId,
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
    authFile = await readAuthFileAsync(profile, authPath);
  }

  return {
    apiKey: authFile.credentials.access,
    status: statusFromAuthFile(authPath, authFile),
  };
}

export async function writeAuthFileAtomicFor(
  profile: StoreProfile,
  authPath: string,
  authFile: OAuthAuthFile,
): Promise<void> {
  const dir = dirname(authPath);
  const nonce = randomBytes(8).toString("hex");
  const tempPath = resolve(
    dir,
    `${profile.tempPrefix}.${process.pid}.${Date.now()}.${nonce}.tmp`,
  );
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

function assertAuthPath(profile: StoreProfile, options: CredentialStoreOptions): void {
  assertSafeChecksFor(profile.label, validateAuthPathFor(profile, options));
}

function readAuthFile(profile: StoreProfile, authPath: string): OAuthAuthFile {
  let raw: string;
  try {
    raw = readFileSync(authPath, "utf8");
  } catch {
    throw new Error(`Could not read ${profile.label} auth file.`);
  }
  return parseAuthFile(profile, raw);
}

async function readAuthFileAsync(
  profile: StoreProfile,
  authPath: string,
): Promise<OAuthAuthFile> {
  let raw: string;
  try {
    raw = await fsPromises.readFile(authPath, "utf8");
  } catch {
    throw new Error(`Could not read ${profile.label} auth file.`);
  }
  return parseAuthFile(profile, raw);
}

function parseAuthFile(profile: StoreProfile, raw: string): OAuthAuthFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid ${profile.label} auth file: not valid JSON.`);
  }

  if (!isObject(parsed))
    throw new Error(
      `Invalid ${profile.label} auth file: top-level value must be an object.`,
    );
  if (parsed.provider !== profile.providerId)
    throw new Error(`Invalid ${profile.label} auth file: unexpected provider.`);
  if (!isObject(parsed.credentials))
    throw new Error(`Invalid ${profile.label} auth file: credentials must be an object.`);

  validateCredentials(profile, parsed.credentials);
  if (parsed.lastRefresh !== undefined && typeof parsed.lastRefresh !== "string") {
    throw new Error(
      `Invalid ${profile.label} auth file: lastRefresh must be a string when present.`,
    );
  }

  return {
    provider: profile.providerId,
    credentials: parsed.credentials,
    ...(parsed.lastRefresh ? { lastRefresh: parsed.lastRefresh } : {}),
  };
}

function validateCredentials(
  profile: StoreProfile,
  value: Record<string, unknown>,
): asserts value is OAuthFileCredentials {
  if (typeof value.access !== "string" || value.access.length === 0) {
    throw new Error(
      `Invalid ${profile.label} auth file: credentials.access must be a non-empty string.`,
    );
  }
  if (typeof value.refresh !== "string" || value.refresh.length === 0) {
    throw new Error(
      `Invalid ${profile.label} auth file: credentials.refresh must be a non-empty string.`,
    );
  }
  if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) {
    throw new Error(
      `Invalid ${profile.label} auth file: credentials.expires must be a finite number.`,
    );
  }
}

function statusFromAuthFile(authPath: string, authFile: OAuthAuthFile): OAuthAuthStatus {
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
  credentials: OAuthFileCredentials,
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

function authFileModeIsSafe(authPath: string): boolean {
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
