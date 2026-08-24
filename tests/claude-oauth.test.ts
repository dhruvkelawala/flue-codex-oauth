import { describe, expect, it, vi } from "vitest";
import { exchangeClaudeCode, refreshClaudeCredentials } from "../src/claude-oauth.ts";

describe("claude oauth token client", () => {
  it("retries transient token endpoint failures and keeps rotated refresh tokens", async () => {
    const now = Date.UTC(2026, 0, 1);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "rotated-refresh",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const sleep = vi.fn(async () => undefined);

    const credentials = await refreshClaudeCredentials(
      { access: "old-access", refresh: "old-refresh", expires: now - 1 },
      { fetch: fetchMock as unknown as typeof fetch, sleep, now: () => now },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
    expect(credentials).toEqual({
      access: "new-access",
      refresh: "rotated-refresh",
      expires: now + 3_600_000,
    });
  });

  it("does not retry non-retryable token failures or leak the response body", async () => {
    const secret = "secret-token-response-body";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(secret, {
        status: 400,
        headers: { "x-should-retry": "false" },
      }),
    );

    const error = await exchangeClaudeCode("code", "state", "verifier", "http://localhost", {
      fetch: fetchMock as unknown as typeof fetch,
      sleep: async () => undefined,
      now: () => 0,
    }).catch((caught: unknown) => caught as Error);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.message).toBe("Claude token request failed with HTTP 400.");
    expect(error.message).not.toContain(secret);
  });

  it("falls back to the current refresh token when refresh responses omit a rotation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          expires_in: 60,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      refreshClaudeCredentials(
        { access: "old-access", refresh: "stable-refresh", expires: 0 },
        { fetch: fetchMock as unknown as typeof fetch, now: () => 1_000 },
      ),
    ).resolves.toEqual({
      access: "new-access",
      refresh: "stable-refresh",
      expires: 61_000,
    });
  });
});
