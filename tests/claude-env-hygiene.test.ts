import { describe, expect, it } from "vitest";
import { checkClaudeEnvHygiene } from "../src/env-hygiene.ts";

describe("claude env hygiene", () => {
  it("rejects real-looking Claude OAuth material without leaking values", () => {
    const rawValue = "claude-refresh-token-secret-12345";
    const checks = checkClaudeEnvHygiene({ CLAUDE_ACCESS_TOKEN: rawValue });

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "claude-no-env-credentials",
        ok: false,
        severity: "error",
      }),
    );
    expect(checks[0]?.message).toContain("CLAUDE_ACCESS_TOKEN");
    expect(JSON.stringify(checks)).not.toContain(rawValue);
  });

  it("rejects Pi AI's Anthropic OAuth env name", () => {
    const checks = checkClaudeEnvHygiene({ ANTHROPIC_OAUTH_TOKEN: "real-oauth-token" });

    expect(checks[0]).toMatchObject({ name: "claude-no-env-credentials", ok: false });
    expect(checks[0]?.message).toContain("ANTHROPIC_OAUTH_TOKEN");
  });

  it("rejects a Claude OAuth token smuggled into ANTHROPIC_API_KEY", () => {
    const checks = checkClaudeEnvHygiene({
      ANTHROPIC_API_KEY: "sk-ant-oat01-real-oauth-token",
    });

    expect(checks[0]).toMatchObject({ name: "claude-no-env-credentials", ok: false });
    expect(checks[0]?.message).toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(checks)).not.toContain("sk-ant-oat01-real-oauth-token");
  });

  it("allows a plain Anthropic API key in ANTHROPIC_API_KEY", () => {
    const checks = checkClaudeEnvHygiene({ ANTHROPIC_API_KEY: "sk-ant-api03-regular-key" });

    expect(checks).toEqual([
      expect.objectContaining({ name: "claude-no-env-credentials", ok: true }),
    ]);
  });

  it("allows placeholder credential values", () => {
    const checks = checkClaudeEnvHygiene({
      CLAUDE_ACCESS_TOKEN: "PH_TOKEN",
      CLAUDE_REFRESH_TOKEN: "placeholder",
      ANTHROPIC_API_KEY: "PH_sk-ant-oat-placeholder",
    });

    expect(checks).toEqual([
      expect.objectContaining({
        name: "claude-no-env-credentials",
        ok: true,
        severity: "error",
      }),
    ]);
  });

  it("enforces extra rejected env names", () => {
    const checks = checkClaudeEnvHygiene({ CUSTOM_CLAUDE_TOKEN: "custom-secret" }, [
      "CUSTOM_CLAUDE_TOKEN",
    ]);

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "claude-no-env-credentials",
        ok: false,
        severity: "error",
        message: expect.stringContaining("CUSTOM_CLAUDE_TOKEN"),
      }),
    );
  });
});
