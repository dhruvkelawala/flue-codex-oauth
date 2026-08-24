import { refreshClaudeCredentials } from "./claude-oauth.js";
import {
  credentialStoreFor,
  type CredentialStoreOptions,
  type OAuthAuthStatus,
  type OAuthFileCredentials,
  type StoreProfile,
} from "./credential-store.js";

export const CLAUDE_PROVIDER_ID = "anthropic";
export const CLAUDE_DEFAULT_AUTH_PATH = "~/.flue/anthropic.json";

export const CLAUDE_STORE_PROFILE: StoreProfile = {
  providerId: CLAUDE_PROVIDER_ID,
  label: "Claude",
  checkPrefix: "claude",
  tempPrefix: ".anthropic",
  refreshCredentials: (credentials) => refreshClaudeCredentials(credentials),
};

export type ClaudeCredentialStoreOptions = CredentialStoreOptions;
export type ClaudeAuthStatus = OAuthAuthStatus;
export type ClaudeOAuthCredentials = OAuthFileCredentials;

const claudeStore = credentialStoreFor(CLAUDE_STORE_PROFILE);

export const validateClaudeAuthPath = claudeStore.validateAuthPath;
export const readClaudeAuthStatus = claudeStore.readAuthStatus;
export const resolveClaudeApiKey = claudeStore.resolveApiKey;
export const writeClaudeAuthFileAtomic = claudeStore.writeAuthFileAtomic;
