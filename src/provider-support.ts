import {
  createProvider,
  type Api,
  type Model,
  type Provider,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import {
  assertSafeChecksFor,
  expandHome,
  type AuthCheck,
  type CredentialStoreOptions,
  type OAuthAuthStatus,
  type StoreProfile,
} from "./credential-store.js";

export interface AuthFileProviderOptions {
  authPath?: string;
  forbiddenPaths?: string[];
  refreshSkewMs?: number;
}

export interface AuthFileProviderConfig<
  TApi extends Api,
  TStatus extends OAuthAuthStatus,
  TPreflightStatus,
> {
  providerId: string;
  providerName: string;
  authName: string;
  defaultAuthPath: string;
  storeProfile: StoreProfile;
  models: readonly Model<TApi>[];
  api: ProviderStreams;
  resolveApiKey(options: CredentialStoreOptions): Promise<{ apiKey: string; status: TStatus }>;
  readAuthStatus(options: CredentialStoreOptions): TStatus;
  validateAuthPath(options: CredentialStoreOptions): AuthCheck[];
  envChecks(env: Record<string, string | undefined>): AuthCheck[];
  safePreflightStatus(status: TStatus): TPreflightStatus;
}

export function createAuthFileProvider<
  TApi extends Api,
  TStatus extends OAuthAuthStatus,
  TPreflightStatus,
>(
  config: AuthFileProviderConfig<TApi, TStatus, TPreflightStatus>,
  options: AuthFileProviderOptions = {},
): Provider<TApi> {
  const storeOptions = toStoreOptions(config.defaultAuthPath, options);
  assertSafe(config, storeOptions);

  return createProvider({
    id: config.providerId,
    name: config.providerName,
    auth: {
      apiKey: {
        name: config.authName,
        resolve: async () => {
          assertSafe(config, storeOptions);
          const { apiKey, status } = await config.resolveApiKey(storeOptions);
          return { auth: { apiKey }, source: status.authPath };
        },
      },
    },
    models: config.models,
    api: config.api,
  });
}

export async function preflightAuthFileProvider<
  TApi extends Api,
  TStatus extends OAuthAuthStatus,
  TPreflightStatus,
>(
  config: AuthFileProviderConfig<TApi, TStatus, TPreflightStatus>,
  options: AuthFileProviderOptions = {},
): Promise<TPreflightStatus> {
  const storeOptions = toStoreOptions(config.defaultAuthPath, options);
  assertSafe(config, storeOptions);
  const { status } = await config.resolveApiKey(storeOptions);
  return config.safePreflightStatus(status);
}

export function authFileProviderStatus<
  TApi extends Api,
  TStatus extends OAuthAuthStatus,
  TPreflightStatus,
>(
  config: AuthFileProviderConfig<TApi, TStatus, TPreflightStatus>,
  options: AuthFileProviderOptions = {},
): TStatus {
  return config.readAuthStatus(toStoreOptions(config.defaultAuthPath, options));
}

export function authFileProviderChecks<
  TApi extends Api,
  TStatus extends OAuthAuthStatus,
  TPreflightStatus,
>(
  config: AuthFileProviderConfig<TApi, TStatus, TPreflightStatus>,
  options: AuthFileProviderOptions = {},
  env: Record<string, string | undefined> = process.env,
): AuthCheck[] {
  return safetyChecks(config, toStoreOptions(config.defaultAuthPath, options), env);
}

function assertSafe<
  TApi extends Api,
  TStatus extends OAuthAuthStatus,
  TPreflightStatus,
>(
  config: AuthFileProviderConfig<TApi, TStatus, TPreflightStatus>,
  storeOptions: CredentialStoreOptions,
): void {
  assertSafeChecksFor(config.storeProfile.label, safetyChecks(config, storeOptions, process.env));
}

function safetyChecks<
  TApi extends Api,
  TStatus extends OAuthAuthStatus,
  TPreflightStatus,
>(
  config: AuthFileProviderConfig<TApi, TStatus, TPreflightStatus>,
  storeOptions: CredentialStoreOptions,
  env: Record<string, string | undefined>,
): AuthCheck[] {
  return [...config.validateAuthPath(storeOptions), ...config.envChecks(env)];
}

function toStoreOptions(
  defaultAuthPath: string,
  options: AuthFileProviderOptions,
): CredentialStoreOptions {
  const storeOptions: CredentialStoreOptions = {
    authPath: expandHome(options.authPath ?? defaultAuthPath),
  };
  if (options.forbiddenPaths !== undefined) {
    storeOptions.forbiddenPaths = options.forbiddenPaths;
  }
  if (options.refreshSkewMs !== undefined) {
    storeOptions.refreshSkewMs = options.refreshSkewMs;
  }
  return storeOptions;
}
