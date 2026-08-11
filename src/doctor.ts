import {
  codexAuthStatus,
  codexProviderChecks,
  preflight,
  type CodexProviderOptions,
} from "./codex-provider.js";
import type { AuthCheck, CodexAuthStatus } from "./credential-store.js";

export interface CodexDoctorReport {
  checks: AuthCheck[];
  status: CodexAuthStatus;
}

/** Validate the installed integration while keeping all credential material private. */
export async function runCodexDoctor(
  options: CodexProviderOptions = {},
): Promise<CodexDoctorReport> {
  const status = codexAuthStatus(options);
  const checks: AuthCheck[] = [
    ...codexProviderChecks(options),
    {
      name: "codex-auth-file-exists",
      ok: status.configured,
      severity: "error",
      message: `Codex auth file was not found: ${status.authPath || "<unset>"}`,
    },
  ];

  if (!hasErrors(checks)) {
    try {
      const resolved = await preflight(options);
      checks.push(
        passed(
          "codex-auth-usable",
          "Credentials are readable and refreshable through the provider factory.",
        ),
      );
      return {
        checks,
        status: {
          configured: true,
          authPath: resolved.authPath,
          ...(resolved.expiresAt ? { expiresAt: resolved.expiresAt } : {}),
          ...(resolved.accountId ? { accountId: resolved.accountId } : {}),
        },
      };
    } catch {
      checks.push({
        name: "codex-auth-usable",
        ok: false,
        severity: "error",
        message: "Credentials could not be read or refreshed when needed.",
      });
    }
  }

  return { checks, status };
}

export function formatCodexDoctorReport(report: CodexDoctorReport): string {
  const lines = ["Flue Codex OAuth doctor", `Auth file: ${report.status.authPath || "<unset>"}`];

  for (const check of report.checks) {
    lines.push(check.ok ? `PASS ${check.name}` : `FAIL ${check.name}: ${check.message}`);
  }

  if (report.status.expiresAt) lines.push(`Token expiry: ${report.status.expiresAt}`);
  lines.push(hasErrors(report.checks) ? "Doctor result: not ready" : "Doctor result: ready");
  return `${lines.join("\n")}\n`;
}

export function doctorPassed(report: CodexDoctorReport): boolean {
  return !hasErrors(report.checks);
}

function passed(name: string, message: string): AuthCheck {
  return { name, ok: true, severity: "error", message };
}

function hasErrors(checks: AuthCheck[]): boolean {
  return checks.some((check) => !check.ok && check.severity === "error");
}
