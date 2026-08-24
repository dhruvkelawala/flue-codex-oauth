import { refreshCodexCredentials } from "./codex-oauth.js";
import {
  credentialStoreFor,
  type CredentialStoreOptions,
  type OAuthAuthStatus,
  type OAuthFileCredentials,
  type StoreProfile,
} from "./credential-store.js";

export const CODEX_PROVIDER_ID = "openai-codex";
export const CODEX_DEFAULT_AUTH_PATH = "~/.flue/openai-codex.json";

export const CODEX_STORE_PROFILE: StoreProfile = {
  providerId: CODEX_PROVIDER_ID,
  label: "Codex",
  checkPrefix: "codex",
  tempPrefix: ".openai-codex",
  refreshCredentials: (credentials) => refreshCodexCredentials(credentials),
};

export type CodexOAuthCredentials = OAuthFileCredentials;
export type CodexCredentialStoreOptions = CredentialStoreOptions;
export type CodexAuthStatus = OAuthAuthStatus;

const codexStore = credentialStoreFor(CODEX_STORE_PROFILE);

export const validateAuthPath = codexStore.validateAuthPath;
export const readAuthStatus = codexStore.readAuthStatus;
export const resolveApiKey = codexStore.resolveApiKey;
export const writeAuthFileAtomic = codexStore.writeAuthFileAtomic;
