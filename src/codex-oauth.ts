import type { OAuthCredential, OAuthCredentials } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { withoutCredentialType } from "./oauth-credentials.js";

/** Return the OAuth implementation shared by login and request-time refresh. */
export function codexOAuth() {
  const oauth = openaiCodexProvider().auth.oauth;
  if (!oauth) throw new Error("Pi openai-codex provider does not expose OAuth.");
  return oauth;
}

/** Refresh package credentials through Pi's Codex OAuth implementation. */
export async function refreshCodexCredentials(
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
  const refreshed = await codexOAuth().refresh({
    ...credentials,
    type: "oauth",
  } as OAuthCredential);
  return withoutCredentialType(refreshed);
}
