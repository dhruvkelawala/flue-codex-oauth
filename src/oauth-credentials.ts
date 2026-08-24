import type { OAuthCredential, OAuthCredentials } from "@earendil-works/pi-ai";

/** Remove Pi's storage discriminator before writing this package's auth files. */
export function withoutCredentialType(
  credential: OAuthCredential,
): OAuthCredentials {
  const { type: _type, ...persisted } = credential;
  return persisted;
}
