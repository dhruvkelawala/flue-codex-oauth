import {
  type ProviderStreams,
  type SimpleStreamOptions,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import {
  CLAUDE_DEFAULT_AUTH_PATH,
  CLAUDE_PROVIDER_ID,
  CLAUDE_STORE_PROFILE,
  readClaudeAuthStatus,
  resolveClaudeApiKey,
  validateClaudeAuthPath,
  type ClaudeAuthStatus,
} from "./claude-credential-store.js";
import { ensureBillingHeader, type PayloadLike } from "./billing-header.js";
import { checkClaudeEnvHygiene } from "./env-hygiene.js";
import {
  authFileProviderChecks,
  authFileProviderStatus,
  createAuthFileProvider,
  preflightAuthFileProvider,
  type AuthFileProviderConfig,
  type AuthFileProviderOptions,
} from "./provider-support.js";

export interface ClaudeProviderOptions extends AuthFileProviderOptions {}

export type ClaudePreflightStatus = Pick<ClaudeAuthStatus, "authPath" | "expiresAt">;

const CLAUDE_PROVIDER_CONFIG: AuthFileProviderConfig<
  "anthropic-messages",
  ClaudeAuthStatus,
  ClaudePreflightStatus
> = {
  providerId: CLAUDE_PROVIDER_ID,
  providerName: "Anthropic Claude (subscription auth file)",
  authName: "Claude subscription auth file",
  defaultAuthPath: CLAUDE_DEFAULT_AUTH_PATH,
  storeProfile: CLAUDE_STORE_PROFILE,
  models: anthropicProvider().getModels(),
  api: anthropicOAuthApi(),
  resolveApiKey: resolveClaudeApiKey,
  readAuthStatus: readClaudeAuthStatus,
  validateAuthPath: validateClaudeAuthPath,
  envChecks: checkClaudeEnvHygiene,
  safePreflightStatus,
};

/** Build a Pi provider that resolves the external auth file on every model request. */
export function claudeProvider(options: ClaudeProviderOptions = {}) {
  return createAuthFileProvider(CLAUDE_PROVIDER_CONFIG, options);
}

/** Resolve once so a host can fail startup closed without exposing token material. */
export function claudePreflight(
  options: ClaudeProviderOptions = {},
): Promise<ClaudePreflightStatus> {
  return preflightAuthFileProvider(CLAUDE_PROVIDER_CONFIG, options);
}

/** Non-throwing snapshot used by doctor commands and host health checks. */
export function claudeAuthStatus(options: ClaudeProviderOptions = {}): ClaudeAuthStatus {
  return authFileProviderStatus(CLAUDE_PROVIDER_CONFIG, options);
}

/** Safety checks used by the provider and doctor command. */
export function claudeProviderChecks(
  options: ClaudeProviderOptions = {},
  env: Record<string, string | undefined> = process.env,
) {
  return authFileProviderChecks(CLAUDE_PROVIDER_CONFIG, options, env);
}

function anthropicOAuthApi(): ProviderStreams {
  const api = anthropicMessagesApi();
  return {
    stream(model, context, options) {
      return api.stream(model, context, withBillingPayload(options));
    },
    streamSimple(model, context, options) {
      return api.streamSimple(model, context, withBillingPayload(options));
    },
  };
}

function withBillingPayload<T extends StreamOptions | SimpleStreamOptions>(
  options: T | undefined,
): T {
  const hostOnPayload = options?.onPayload;
  return {
    ...options,
    onPayload: async (payload, model) => {
      const transformed = ensureBillingHeader(payload as PayloadLike);
      if (!hostOnPayload) return transformed;
      return (await hostOnPayload(transformed, model)) ?? transformed;
    },
  } as T;
}

function safePreflightStatus(status: ClaudeAuthStatus): ClaudePreflightStatus {
  const safeStatus: ClaudePreflightStatus = { authPath: status.authPath };
  if (status.expiresAt !== undefined) safeStatus.expiresAt = status.expiresAt;
  return safeStatus;
}
