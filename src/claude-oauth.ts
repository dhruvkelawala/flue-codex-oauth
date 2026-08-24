import { createServer, type Server } from "node:http";
import type { AuthInteraction, OAuthCredential, OAuthCredentials } from "@earendil-works/pi-ai";

const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CALLBACK_HOST = "localhost";
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const MANUAL_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const CLAUDE_SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
].join(" ");
const DEFAULT_TOKEN_ATTEMPTS = 3;

export interface ClaudeTokenClientOptions {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  attempts?: number;
}

interface AuthorizationCodeResult {
  code: string;
  state: string;
}

interface CallbackServer {
  waitForCode: () => Promise<AuthorizationCodeResult | null>;
  cancelWait: () => void;
  close: () => Promise<void>;
}

/** OAuth implementation shared by login and request-time refresh. */
export function claudeOAuth() {
  return {
    name: "Anthropic (Claude Pro/Max)",
    login: async (interaction: AuthInteraction) => ({
      type: "oauth" as const,
      ...(await loginClaudeCredentials(interaction)),
    }),
    refresh: async (credential: OAuthCredential) => ({
      type: "oauth" as const,
      ...(await refreshClaudeCredentials(credential)),
    }),
    async toAuth(credential: OAuthCredential) {
      return { apiKey: credential.access };
    },
  };
}

/** Run Claude's browser OAuth flow and return package-persistable credentials. */
export async function loginClaudeCredentials(
  interaction: AuthInteraction,
  options: ClaudeTokenClientOptions = {},
): Promise<OAuthCredentials> {
  const { verifier, challenge } = await generatePkce();
  const state = createState();
  const callback = await startCallbackServer(state).catch(() => undefined);
  const redirectUri = callback ? REDIRECT_URI : MANUAL_REDIRECT_URI;
  const manualAbort = new AbortController();
  let manualInput: string | undefined;
  let manualError: Error | undefined;

  try {
    interaction.notify({
      type: "auth_url",
      url: makeAuthorizeUrl(challenge, state, redirectUri),
      instructions:
        "Complete login in your browser. If the browser is on another machine, paste the final redirect URL here.",
    });

    const manualPromise = interaction
      .prompt({
        type: "manual_code",
        message:
          "Complete login in your browser, or paste the authorization code / redirect URL here:",
        placeholder: redirectUri,
        signal: manualAbort.signal,
      })
      .then((input) => {
        manualInput = input;
        callback?.cancelWait();
      })
      .catch((error) => {
        if (!manualAbort.signal.aborted) {
          manualError = error instanceof Error ? error : new Error(String(error));
        }
        callback?.cancelWait();
      });

    const callbackResult = callback ? await callback.waitForCode() : null;
    if (manualError && !callbackResult) throw manualError;

    let parsed = callbackResult;
    if (!parsed && manualInput) parsed = parseAuthorizationInput(manualInput);
    if (!parsed) {
      await manualPromise;
      if (manualError) throw manualError;
      if (manualInput) parsed = parseAuthorizationInput(manualInput);
    }

    if (!parsed?.code) throw new Error("Missing authorization code.");
    if (parsed.state !== state) throw new Error("OAuth state mismatch.");

    interaction.notify({
      type: "progress",
      message: "Exchanging authorization code for tokens...",
    });
    return exchangeClaudeCode(parsed.code, parsed.state, verifier, redirectUri, options);
  } finally {
    manualAbort.abort();
    await callback?.close();
  }
}

export async function exchangeClaudeCode(
  code: string,
  state: string,
  verifier: string,
  redirectUri: string,
  options: ClaudeTokenClientOptions = {},
): Promise<OAuthCredentials> {
  const data = await tokenRequest(
    {
      grant_type: "authorization_code",
      client_id: CLAUDE_CLIENT_ID,
      code,
      state,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
    options,
  );
  return parseToken(data, undefined, options.now?.() ?? Date.now());
}

/** Refresh package credentials through Claude's OAuth token endpoint. */
export async function refreshClaudeCredentials(
  credentials: OAuthCredentials,
  options: ClaudeTokenClientOptions = {},
): Promise<OAuthCredentials> {
  const data = await tokenRequest(
    {
      grant_type: "refresh_token",
      client_id: CLAUDE_CLIENT_ID,
      refresh_token: credentials.refresh,
    },
    options,
  );
  return parseToken(data, credentials.refresh, options.now?.() ?? Date.now());
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function createState(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function makeAuthorizeUrl(challenge: string, state: string, redirectUri: string): string {
  return `${AUTHORIZE_URL}?${new URLSearchParams({
    code: "true",
    client_id: CLAUDE_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: CLAUDE_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  })}`;
}

function parseAuthorizationInput(input: string): AuthorizationCodeResult | null {
  const value = input.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    return code && state ? { code, state } : null;
  } catch {
    // not a URL
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return code && state ? { code, state } : null;
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    const code = params.get("code");
    const state = params.get("state");
    return code && state ? { code, state } : null;
  }

  return null;
}

async function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  const server = createServer();
  let settleWait!: (value: AuthorizationCodeResult | null) => void;
  let settled = false;
  const waitForCodePromise = new Promise<AuthorizationCodeResult | null>((resolve) => {
    settleWait = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });

  server.on("request", (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Missing callback values");
      return;
    }
    if (state !== expectedState) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid state");
      settleWait(null);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Authorization complete</title><h1>Authorization complete</h1><p>You can close this window.</p>");
    settleWait({ code, state });
  });

  await listen(server);
  return {
    waitForCode: () => waitForCodePromise,
    cancelWait: () => settleWait(null),
    close: async () => closeServer(server),
  };
}

async function tokenRequest(
  body: Record<string, string>,
  options: ClaudeTokenClientOptions,
): Promise<unknown> {
  const fetcher = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = Math.max(1, options.attempts ?? DEFAULT_TOKEN_ATTEMPTS);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new Error("Claude token endpoint returned invalid JSON.");
      }
    }

    const retryable =
      response.headers.get("x-should-retry") !== "false" &&
      (response.status === 429 || response.status >= 500);
    if (!retryable || attempt === attempts - 1) {
      throw new Error(`Claude token request failed with HTTP ${response.status}.`);
    }

    const retryAfter = retryAfterMs(response.headers.get("retry-after"), options.now?.() ?? Date.now());
    await sleep(retryAfter ?? 500 * 2 ** attempt);
  }

  throw new Error("Claude token request failed.");
}

function retryAfterMs(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(0, date - now), 30_000);
}

function parseToken(
  value: unknown,
  fallbackRefresh: string | undefined,
  now: number,
): OAuthCredentials {
  if (
    !isObject(value) ||
    typeof value.access_token !== "string" ||
    value.access_token.length === 0 ||
    typeof value.expires_in !== "number" ||
    !Number.isFinite(value.expires_in)
  ) {
    throw new Error("Claude token response had an invalid shape.");
  }
  const refresh =
    typeof value.refresh_token === "string" && value.refresh_token.length > 0
      ? value.refresh_token
      : fallbackRefresh;
  if (!refresh) throw new Error("Claude token response did not include a refresh token.");
  return { access: value.access_token, refresh, expires: now + value.expires_in * 1000 };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(CALLBACK_PORT, CALLBACK_HOST, () => resolve());
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
