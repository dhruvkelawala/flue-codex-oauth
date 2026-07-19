import { registerProvider as flueRegisterProvider } from "@flue/runtime";
import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import {
  expandHome,
  readAuthStatus,
  resolveApiKey,
  validateAuthPath,
  type AuthCheck,
  type CodexAuthStatus,
} from "./credential-store.js";
import { checkEnvHygiene } from "./env-hygiene.js";

const CODEX_PROVIDER_ID = "openai-codex";
const DEFAULT_AUTH_PATH = "~/.flue/openai-codex.json";

export interface CodexAuthOptions {
  /** Auth file path; "~/" is expanded. Default: "~/.flue/openai-codex.json". */
  authPath?: string;
  /** Paths the auth file must not live inside. Default: [process.cwd()]. */
  forbiddenPaths?: string[];
  /** Refresh this long before expiry. Default: 300_000. */
  refreshSkewMs?: number;
  /** Extra env names to reject alongside the built-in Codex list. */
  rejectedEnvNames?: string[];
  /** Set false to skip env hygiene checks entirely. Default: true. */
  envHygiene?: boolean;
  /** Test seams. */
  env?: Record<string, string | undefined>;
  now?: () => number;
  refreshToken?: (refresh: string) => Promise<OAuthCredentials>;
  registerProvider?: (providerId: string, registration: { apiKey: string }) => void;
}

export interface CodexAuth {
  /** Resolve (refreshing if stale) and registerProvider("openai-codex", { apiKey }). */
  configure(): Promise<CodexAuthStatus>;
  /** Hono-compatible middleware: configure() then next(). Single-flight. */
  middleware(): (c: unknown, next: () => Promise<void>) => Promise<void>;
  /** Non-throwing snapshot of the auth file state. */
  status(): CodexAuthStatus;
  /** All validation checks (path safety + env hygiene) without side effects. */
  checks(): AuthCheck[];
}

export function codexAuth(options: CodexAuthOptions = {}): CodexAuth {
  let inFlightConfigure: Promise<CodexAuthStatus> | undefined;

  const auth = {
    configure(): Promise<CodexAuthStatus> {
      if (!inFlightConfigure) {
        inFlightConfigure = configureOnce(options).finally(() => {
          inFlightConfigure = undefined;
        });
      }

      return inFlightConfigure;
    },

    middleware(): (c: unknown, next: () => Promise<void>) => Promise<void> {
      return async (_c, next) => {
        await auth.configure();
        await next();
      };
    },

    status(): CodexAuthStatus {
      return readAuthStatus(storeOptions(options));
    },

    checks(): AuthCheck[] {
      return checksForOptions(options);
    },
  };

  return auth;
}

async function configureOnce(options: CodexAuthOptions): Promise<CodexAuthStatus> {
  const failed = checksForOptions(options).filter((item) => !item.ok && item.severity === "error");
  if (failed.length > 0) {
    throw new Error(
      `Codex subscription auth is not safe to use:\n${failed.map((item) => `- ${item.name}: ${item.message}`).join("\n")}`,
    );
  }

  const { apiKey, status } = await resolveApiKey(storeOptions(options));
  const register = options.registerProvider ?? flueRegisterProvider;
  register(CODEX_PROVIDER_ID, { apiKey });
  return status;
}

function checksForOptions(options: CodexAuthOptions): AuthCheck[] {
  const checks = validateAuthPath(storeOptions(options));

  checks.push({
    name: "flue-runtime-integration",
    ok: typeof (options.registerProvider ?? flueRegisterProvider) === "function",
    severity: "error",
    message: "@flue/runtime registerProvider is unavailable — is @flue/runtime installed as a peer?",
  });

  if (options.envHygiene !== false) {
    checks.push(...checkEnvHygiene(options.env ?? process.env, options.rejectedEnvNames));
  }

  return checks;
}

function storeOptions(options: CodexAuthOptions) {
  return {
    authPath: expandHome(options.authPath ?? DEFAULT_AUTH_PATH),
    ...(options.forbiddenPaths !== undefined ? { forbiddenPaths: options.forbiddenPaths } : {}),
    ...(options.refreshSkewMs !== undefined ? { refreshSkewMs: options.refreshSkewMs } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.refreshToken !== undefined ? { refreshToken: options.refreshToken } : {}),
  };
}
