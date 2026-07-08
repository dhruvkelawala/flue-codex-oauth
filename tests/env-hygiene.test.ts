import { describe, expect, it } from "vitest";
import { checkEnvHygiene } from "../src/env-hygiene.ts";

describe("env hygiene", () => {
  it("rejects real-looking Codex OAuth material without leaking values", () => {
    const rawValue = "codex-refresh-token-secret-12345";
    const checks = checkEnvHygiene({ CODEX_ACCESS_TOKEN: rawValue });

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "codex-no-env-credentials",
        ok: false,
        severity: "error",
      }),
    );
    expect(checks[0]?.message).toContain("CODEX_ACCESS_TOKEN");
    expect(JSON.stringify(checks)).not.toContain(rawValue);
  });

  it("allows placeholder credential values", () => {
    const checks = checkEnvHygiene({
      CODEX_ACCESS_TOKEN: "PH_TOKEN",
      CODEX_REFRESH_TOKEN: "placeholder",
    });

    expect(checks).toEqual([
      expect.objectContaining({
        name: "codex-no-env-credentials",
        ok: true,
        severity: "error",
      }),
    ]);
  });

  it("enforces extra rejected env names", () => {
    const checks = checkEnvHygiene({ CUSTOM_CODEX_TOKEN: "custom-secret" }, [
      "CUSTOM_CODEX_TOKEN",
    ]);

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "codex-no-env-credentials",
        ok: false,
        severity: "error",
        message: expect.stringContaining("CUSTOM_CODEX_TOKEN"),
      }),
    );
  });
});
