import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, type Mock } from "vitest";

interface DoctorCaseConfig<Report> {
  label: string;
  checkPrefix: string;
  providerId: string;
  unsafeEnvName: string;
  setProvider: Mock;
  createAuthFile(expires: number): string;
  runDoctor(
    options: { authPath: string; forbiddenPaths?: string[] },
    env?: Record<string, string | undefined>,
  ): Promise<Report>;
  formatReport(report: Report): string;
  passed(report: Report): boolean;
}

export function runDoctorCases<Report>(config: DoctorCaseConfig<Report>): void {
  it("reports a missing auth file as not ready", async () => {
    const authPath = join(
      mkdtempSync(join(tmpdir(), `${config.checkPrefix}-doctor-missing-`)),
      "missing.json",
    );
    const report = await config.runDoctor({ authPath, forbiddenPaths: [] });

    expect((report as { checks: unknown[] }).checks).toContainEqual(
      expect.objectContaining({ name: `${config.checkPrefix}-auth-file-exists`, ok: false }),
    );
    expect(config.passed(report)).toBe(false);
  });

  it("validates usable credentials through preflight", async () => {
    const authPath = config.createAuthFile(Date.now() + 600_000);
    const report = await config.runDoctor({ authPath, forbiddenPaths: [] });

    expect(config.setProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: config.providerId }),
    );
    expect((report as { checks: unknown[] }).checks).toContainEqual(
      expect.objectContaining({ name: `${config.checkPrefix}-auth-usable`, ok: true }),
    );
    expect(config.passed(report)).toBe(true);
  });

  it("does not expose malformed credential material", async () => {
    const secret = "malformed-secret-token";
    const authPath = config.createAuthFile(Date.now() + 600_000);
    writeFileSync(authPath, `{"access":"${secret}"`, { mode: 0o600 });

    const report = await config.runDoctor({ authPath, forbiddenPaths: [] });
    const output = config.formatReport(report);

    expect(config.passed(report)).toBe(false);
    expect(output).not.toContain(secret);
  });

  it("reports provider registration failures", async () => {
    const authPath = config.createAuthFile(Date.now() + 600_000);
    config.setProvider.mockImplementationOnce(() => {
      throw new Error("registration failed");
    });

    const report = await config.runDoctor({ authPath, forbiddenPaths: [] });

    expect((report as { checks: unknown[] }).checks).toContainEqual(
      expect.objectContaining({ name: `${config.checkPrefix}-auth-usable`, ok: false }),
    );
    expect(config.passed(report)).toBe(false);
  });

  it("reports unsafe environment names without exposing their values", async () => {
    const secret = "unsafe-secret-token";
    const report = await config.runDoctor(
      {
        authPath: config.createAuthFile(Date.now() + 600_000),
        forbiddenPaths: [],
      },
      { [config.unsafeEnvName]: secret },
    );
    const output = config.formatReport(report);

    expect(output).toContain(config.unsafeEnvName);
    expect(output).not.toContain(secret);
    expect(config.passed(report)).toBe(false);
  });
}
