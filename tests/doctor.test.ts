import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  doctorPassed,
  formatCodexDoctorReport,
  runCodexDoctor,
} from "../src/doctor.ts";
import { createAuthFile } from "./auth-fixture.ts";

const { setProvider } = vi.hoisted(() => ({ setProvider: vi.fn() }));
vi.mock("@flue/runtime", () => ({ setProvider }));

describe("Codex OAuth doctor", () => {
  beforeEach(() => setProvider.mockReset());

  it("reports a missing auth file as not ready", async () => {
    const authPath = join(mkdtempSync(join(tmpdir(), "codex-doctor-missing-")), "missing.json");
    const report = await runCodexDoctor({ authPath, forbiddenPaths: [] });

    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "codex-auth-file-exists", ok: false }),
    );
    expect(doctorPassed(report)).toBe(false);
  });

  it("validates usable credentials through preflight", async () => {
    const authPath = createAuthFile(Date.now() + 600_000);
    const report = await runCodexDoctor({ authPath, forbiddenPaths: [] });

    expect(setProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: "openai-codex" }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "codex-auth-usable", ok: true }),
    );
    expect(doctorPassed(report)).toBe(true);
  });

  it("does not expose malformed credential material", async () => {
    const secret = "malformed-secret-token";
    const authPath = createAuthFile(Date.now() + 600_000);
    writeFileSync(authPath, `{"access":"${secret}"`, { mode: 0o600 });

    const report = await runCodexDoctor({ authPath, forbiddenPaths: [] });
    const output = formatCodexDoctorReport(report);

    expect(doctorPassed(report)).toBe(false);
    expect(output).not.toContain(secret);
  });

  it("reports provider registration failures", async () => {
    const authPath = createAuthFile(Date.now() + 600_000);
    setProvider.mockImplementationOnce(() => {
      throw new Error("registration failed");
    });

    const report = await runCodexDoctor({ authPath, forbiddenPaths: [] });

    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "codex-auth-usable", ok: false }),
    );
    expect(doctorPassed(report)).toBe(false);
  });

  it("reports unsafe environment names without exposing their values", async () => {
    const secret = "unsafe-secret-token";
    const report = await runCodexDoctor(
      {
        authPath: createAuthFile(Date.now() + 600_000),
        forbiddenPaths: [],
      },
      { CODEX_ACCESS_TOKEN: secret },
    );
    const output = formatCodexDoctorReport(report);

    expect(output).toContain("CODEX_ACCESS_TOKEN");
    expect(output).not.toContain(secret);
    expect(doctorPassed(report)).toBe(false);
  });
});
