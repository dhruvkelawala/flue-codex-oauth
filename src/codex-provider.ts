import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import {
  CODEX_DEFAULT_AUTH_PATH,
  CODEX_PROVIDER_ID,
  CODEX_STORE_PROFILE,
  readAuthStatus,
  resolveApiKey,
  validateAuthPath,
  type CodexAuthStatus,
} from "./codex-credential-store.js";
import { checkEnvHygiene } from "./env-hygiene.js";
import {
  authFileProviderChecks,
  authFileProviderStatus,
  createAuthFileProvider,
  preflightAuthFileProvider,
  type AuthFileProviderConfig,
  type AuthFileProviderOptions,
} from "./provider-support.js";

export interface CodexProviderOptions extends AuthFileProviderOptions {}

export type CodexPreflightStatus = Pick<
  CodexAuthStatus,
  "authPath" | "expiresAt" | "accountId"
>;

const CODEX_PROVIDER_CONFIG: AuthFileProviderConfig<
  "openai-codex-responses",
  CodexAuthStatus,
  CodexPreflightStatus
> = {
  providerId: CODEX_PROVIDER_ID,
  providerName: "OpenAI Codex (subscription auth file)",
  authName: "Codex subscription auth file",
  defaultAuthPath: CODEX_DEFAULT_AUTH_PATH,
  storeProfile: CODEX_STORE_PROFILE,
  models: openaiCodexProvider().getModels(),
  api: openAICodexResponsesApi(),
  resolveApiKey,
  readAuthStatus,
  validateAuthPath,
  envChecks: checkEnvHygiene,
  safePreflightStatus,
};

/** Build a Pi provider that resolves the external auth file on every model request. */
export function codexProvider(options: CodexProviderOptions = {}) {
  return createAuthFileProvider(CODEX_PROVIDER_CONFIG, options);
}

/** Resolve once so a host can fail startup closed without exposing token material. */
export function codexPreflight(
  options: CodexProviderOptions = {},
): Promise<CodexPreflightStatus> {
  return preflightAuthFileProvider(CODEX_PROVIDER_CONFIG, options);
}

/** Compatibility alias for the original Codex-only public API. */
export const preflight = codexPreflight;

/** Non-throwing snapshot used by doctor commands and host health checks. */
export function codexAuthStatus(options: CodexProviderOptions = {}): CodexAuthStatus {
  return authFileProviderStatus(CODEX_PROVIDER_CONFIG, options);
}

/** Safety checks used by the provider and doctor command. */
export function codexProviderChecks(
  options: CodexProviderOptions = {},
  env: Record<string, string | undefined> = process.env,
) {
  return authFileProviderChecks(CODEX_PROVIDER_CONFIG, options, env);
}

function safePreflightStatus(status: CodexAuthStatus): CodexPreflightStatus {
  const safeStatus: CodexPreflightStatus = { authPath: status.authPath };
  if (status.expiresAt !== undefined) safeStatus.expiresAt = status.expiresAt;
  if (status.accountId !== undefined) safeStatus.accountId = status.accountId;
  return safeStatus;
}
