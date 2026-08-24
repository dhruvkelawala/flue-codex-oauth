import { createProvider, type Provider } from "@earendil-works/pi-ai";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import {
  assertSafeChecks,
  expandHome,
  readAuthStatus,
  resolveApiKey,
  validateAuthPath,
  type AuthCheck,
  type CodexAuthStatus,
  type CodexCredentialStoreOptions,
} from "./credential-store.js";
import { checkEnvHygiene } from "./env-hygiene.js";

const CODEX_PROVIDER_ID = "openai-codex";
const DEFAULT_AUTH_PATH = "~/.flue/openai-codex.json";

export interface CodexProviderOptions {
  /** Auth file path; "~/" is expanded. Default: "~/.flue/openai-codex.json". */
  authPath?: string;
  /** Paths the auth file must not equal or live inside. Default: [process.cwd()]. */
  forbiddenPaths?: string[];
  /** Refresh this long before expiry. Default: 300_000 (5 min). */
  refreshSkewMs?: number;
}

export type CodexPreflightStatus = Pick<
  CodexAuthStatus,
  "authPath" | "expiresAt" | "accountId"
>;

/** Build a Pi provider that resolves the external auth file on every model request. */
export function codexProvider(
  options: CodexProviderOptions = {},
): Provider<"openai-codex-responses"> {
  const storeOptions = toStoreOptions(options);
  assertSafe(storeOptions);

  return createProvider({
    id: CODEX_PROVIDER_ID,
    name: "OpenAI Codex (subscription auth file)",
    auth: {
      apiKey: {
        name: "Codex subscription auth file",
        resolve: async () => {
          assertSafe(storeOptions);
          const { apiKey, status } = await resolveApiKey(storeOptions);
          return { auth: { apiKey }, source: status.authPath };
        },
      },
    },
    models: openaiCodexProvider().getModels(),
    api: openAICodexResponsesApi(),
  });
}

/** Resolve once so a host can fail startup closed without exposing token material. */
export async function preflight(
  options: CodexProviderOptions = {},
): Promise<CodexPreflightStatus> {
  const storeOptions = toStoreOptions(options);
  assertSafe(storeOptions);
  const { status } = await resolveApiKey(storeOptions);
  return safePreflightStatus(status);
}

/** @internal Non-throwing snapshot used by the doctor command. */
export function codexAuthStatus(options: CodexProviderOptions = {}): CodexAuthStatus {
  return readAuthStatus(toStoreOptions(options));
}

/** @internal Safety checks used by the provider and doctor command. */
export function codexProviderChecks(
  options: CodexProviderOptions = {},
  env: Record<string, string | undefined> = process.env,
): AuthCheck[] {
  return safetyChecks(toStoreOptions(options), env);
}

function safetyChecks(
  storeOptions: CodexCredentialStoreOptions,
  env: Record<string, string | undefined>,
): AuthCheck[] {
  return [...validateAuthPath(storeOptions), ...checkEnvHygiene(env)];
}

function assertSafe(storeOptions: CodexCredentialStoreOptions): void {
  assertSafeChecks(safetyChecks(storeOptions, process.env));
}

function toStoreOptions(options: CodexProviderOptions): CodexCredentialStoreOptions {
  const storeOptions: CodexCredentialStoreOptions = {
    authPath: expandHome(options.authPath ?? DEFAULT_AUTH_PATH),
  };
  if (options.forbiddenPaths !== undefined) {
    storeOptions.forbiddenPaths = options.forbiddenPaths;
  }
  if (options.refreshSkewMs !== undefined) {
    storeOptions.refreshSkewMs = options.refreshSkewMs;
  }
  return storeOptions;
}

function safePreflightStatus(status: CodexAuthStatus): CodexPreflightStatus {
  const safeStatus: CodexPreflightStatus = { authPath: status.authPath };
  if (status.expiresAt !== undefined) safeStatus.expiresAt = status.expiresAt;
  if (status.accountId !== undefined) safeStatus.accountId = status.accountId;
  return safeStatus;
}
