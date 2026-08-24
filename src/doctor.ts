import { setProvider } from "@flue/runtime";
import {
  codexAuthStatus,
  codexProvider,
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
  env: Record<string, string | undefined> = process.env,
): Promise<CodexDoctorReport> {
  const status = codexAuthStatus(options);
  const checks: AuthCheck[] = [
    ...codexProviderChecks(options, env),
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
      setProvider(codexProvider(options));
      checks.push(
        passed(
          "codex-auth-usable",
          "Credentials are readable and refreshable, and the provider registered successfully.",
        ),
      );
      return { checks, status: { configured: true, ...resolved } };
    } catch {
      checks.push({
        name: "codex-auth-usable",
        ok: false,
        severity: "error",
        message:
          "Credentials could not be read, refreshed when needed, or registered with the host runtime.",
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
