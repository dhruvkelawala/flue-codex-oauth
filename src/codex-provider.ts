import { createProvider, type Provider } from "@earendil-works/pi-ai";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import {
  expandHome,
  readAuthStatus,
  resolveApiKey,
  validateAuthPath,
  type AuthCheck,
  type CodexAuthStatus,
  type CodexCredentialStoreOptions,
} from "./credential-store.js";
import { checkEnvHygiene } from "./env-hygiene.js";

export const CODEX_PROVIDER_ID = "openai-codex";
export const DEFAULT_AUTH_PATH = "~/.flue/openai-codex.json";

export interface CodexProviderOptions
  extends Omit<CodexCredentialStoreOptions, "authPath"> {
  /** Auth file path; "~/" is expanded. Default: "~/.flue/openai-codex.json". */
  authPath?: string;
  /** Extra env names to reject alongside the built-in Codex list. */
  rejectedEnvNames?: string[];
  /** Set false to skip env hygiene checks entirely. Default: true. */
  envHygiene?: boolean;
  /** Injectable environment, for tests and custom bootstrapping. */
  env?: Record<string, string | undefined>;
}

/** Build a Pi provider that resolves the external auth file on every model request. */
export function codexProvider(
  options: CodexProviderOptions = {},
): Provider<"openai-codex-responses"> {
  const storeOptions = toStoreOptions(options);
  assertSafe(options, storeOptions);

  return createProvider({
    id: CODEX_PROVIDER_ID,
    name: "OpenAI Codex (subscription auth file)",
    auth: {
      apiKey: {
        name: "Codex subscription auth file",
        resolve: async () => {
          assertSafe(options, storeOptions);
          const { apiKey } = await resolveApiKey(storeOptions);
          return { auth: { apiKey }, source: storeOptions.authPath };
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
): Promise<Pick<CodexAuthStatus, "authPath" | "expiresAt" | "accountId">> {
  const storeOptions = toStoreOptions(options);
  assertSafe(options, storeOptions);
  const { status } = await resolveApiKey(storeOptions);
  return {
    authPath: status.authPath,
    ...(status.expiresAt ? { expiresAt: status.expiresAt } : {}),
    ...(status.accountId ? { accountId: status.accountId } : {}),
  };
}

/** Non-throwing snapshot of the configured auth file. */
export function codexAuthStatus(options: CodexProviderOptions = {}): CodexAuthStatus {
  return readAuthStatus(toStoreOptions(options));
}

/** Path-safety and environment-hygiene checks without refreshing credentials. */
export function codexProviderChecks(options: CodexProviderOptions = {}): AuthCheck[] {
  const checks = validateAuthPath(toStoreOptions(options));
  if (options.envHygiene !== false) {
    checks.push(...checkEnvHygiene(options.env ?? process.env, options.rejectedEnvNames));
  }
  return checks;
}

function assertSafe(
  options: CodexProviderOptions,
  storeOptions: CodexCredentialStoreOptions,
): void {
  const checks = [
    ...validateAuthPath(storeOptions),
    ...(options.envHygiene === false
      ? []
      : checkEnvHygiene(options.env ?? process.env, options.rejectedEnvNames)),
  ];
  const failed = checks.filter((item) => !item.ok && item.severity === "error");
  if (failed.length > 0) {
    throw new Error(
      `Codex subscription auth is not safe to use:\n${failed.map((item) => `- ${item.name}: ${item.message}`).join("\n")}`,
    );
  }
}

function toStoreOptions(options: CodexProviderOptions): CodexCredentialStoreOptions {
  return {
    authPath: expandHome(options.authPath ?? DEFAULT_AUTH_PATH),
    ...(options.forbiddenPaths !== undefined
      ? { forbiddenPaths: options.forbiddenPaths }
      : {}),
    ...(options.refreshSkewMs !== undefined
      ? { refreshSkewMs: options.refreshSkewMs }
      : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.refreshCredentials !== undefined
      ? { refreshCredentials: options.refreshCredentials }
      : {}),
  };
}
