import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  doctorPassed,
  formatCodexDoctorReport,
  runCodexDoctor,
} from "../src/doctor.ts";

describe("Codex OAuth doctor", () => {
  it("reports a missing auth file as not ready", async () => {
    const authPath = join(mkdtempSync(join(tmpdir(), "codex-doctor-missing-")), "missing.json");
    const report = await runCodexDoctor({ authPath, forbiddenPaths: [] });

    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "codex-auth-file-exists", ok: false }),
    );
    expect(doctorPassed(report)).toBe(false);
  });

  it("validates usable credentials through preflight", async () => {
    const authPath = authFilePath(Date.now() + 600_000);
    const report = await runCodexDoctor({ authPath, forbiddenPaths: [] });

    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "codex-auth-usable", ok: true }),
    );
    expect(doctorPassed(report)).toBe(true);
  });

  it("refreshes stale credentials without exposing token material", async () => {
    const now = Date.now();
    const authPath = authFilePath(now - 1_000);
    const secret = "refreshed-secret-token";
    const report = await runCodexDoctor({
      authPath,
      forbiddenPaths: [],
      now: () => now,
      refreshCredentials: async () => ({
        access: secret,
        refresh: "refreshed-secret-refresh",
        expires: now + 3_600_000,
      }),
    });
    const output = formatCodexDoctorReport(report);

    expect(doctorPassed(report)).toBe(true);
    expect(output).not.toContain(secret);
    expect(output).not.toContain("refreshed-secret-refresh");
  });

  it("reports unsafe environment names without exposing their values", async () => {
    const secret = "unsafe-secret-token";
    const report = await runCodexDoctor({
      authPath: authFilePath(Date.now() + 600_000),
      forbiddenPaths: [],
      env: { CODEX_ACCESS_TOKEN: secret },
    });
    const output = formatCodexDoctorReport(report);

    expect(output).toContain("CODEX_ACCESS_TOKEN");
    expect(output).not.toContain(secret);
    expect(doctorPassed(report)).toBe(false);
  });
});

function authFilePath(expires: number): string {
  const authPath = join(mkdtempSync(join(tmpdir(), "codex-doctor-")), "openai-codex.json");
  writeFileSync(
    authPath,
    JSON.stringify({
      provider: "openai-codex",
      credentials: {
        access: "test-access",
        refresh: "test-refresh",
        expires,
      },
    }),
    { mode: 0o600 },
  );
  chmodSync(authPath, 0o600);
  return authPath;
}
