import { setProvider } from "@flue/runtime";
import type { Provider } from "@earendil-works/pi-ai";
import type { AuthCheck, OAuthAuthStatus } from "./credential-store.js";

export interface DoctorReport<Status extends OAuthAuthStatus = OAuthAuthStatus> {
  checks: AuthCheck[];
  status: Status;
}

export interface DoctorConfig<Options, Status extends OAuthAuthStatus> {
  title: string;
  label: string;
  checkPrefix: string;
  authStatus(options: Options): Status;
  providerChecks(options: Options, env: Record<string, string | undefined>): AuthCheck[];
  preflight(options: Options): Promise<Partial<Status>>;
  provider(options: Options): Provider;
}

/** Validate an installed provider integration while keeping credential material private. */
export async function runDoctorFor<Options, Status extends OAuthAuthStatus>(
  config: DoctorConfig<Options, Status>,
  options: Options,
  env: Record<string, string | undefined> = process.env,
): Promise<DoctorReport<Status>> {
  const status = config.authStatus(options);
  const checks: AuthCheck[] = [
    ...config.providerChecks(options, env),
    {
      name: `${config.checkPrefix}-auth-file-exists`,
      ok: status.configured,
      severity: "error",
      message: `${config.label} auth file was not found: ${status.authPath || "<unset>"}`,
    },
  ];

  if (!hasErrors(checks)) {
    try {
      const resolved = await config.preflight(options);
      setProvider(config.provider(options));
      checks.push(
        passingCheck(
          `${config.checkPrefix}-auth-usable`,
          "Credentials are readable and refreshable, and the provider registered successfully.",
        ),
      );
      return { checks, status: { configured: true, ...resolved } as Status };
    } catch {
      checks.push({
        name: `${config.checkPrefix}-auth-usable`,
        ok: false,
        severity: "error",
        message:
          "Credentials could not be read, refreshed when needed, or registered with the host runtime.",
      });
    }
  }

  return { checks, status };
}

export function formatDoctorReport<Status extends OAuthAuthStatus>(
  config: Pick<DoctorConfig<unknown, Status>, "title">,
  report: DoctorReport<Status>,
): string {
  const lines = [config.title, `Auth file: ${report.status.authPath || "<unset>"}`];

  for (const check of report.checks) {
    lines.push(check.ok ? `PASS ${check.name}` : `FAIL ${check.name}: ${check.message}`);
  }

  if (report.status.expiresAt) lines.push(`Token expiry: ${report.status.expiresAt}`);
  lines.push(doctorPassed(report) ? "Doctor result: ready" : "Doctor result: not ready");
  return `${lines.join("\n")}\n`;
}

export function doctorPassed(report: DoctorReport): boolean {
  return !hasErrors(report.checks);
}

function passingCheck(name: string, message: string): AuthCheck {
  return { name, ok: true, severity: "warning", message };
}

function hasErrors(checks: AuthCheck[]): boolean {
  return checks.some((check) => !check.ok && check.severity === "error");
}
