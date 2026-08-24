import {
  codexAuthStatus,
  codexProvider,
  codexProviderChecks,
  preflight,
  type CodexProviderOptions,
} from "./codex-provider.js";
import type { CodexAuthStatus } from "./codex-credential-store.js";
import {
  doctorPassed,
  formatDoctorReport,
  runDoctorFor,
  type DoctorConfig,
  type DoctorReport,
} from "./doctor-support.js";

const CODEX_DOCTOR: DoctorConfig<CodexProviderOptions, CodexAuthStatus> = {
  title: "Flue Codex OAuth doctor",
  label: "Codex",
  checkPrefix: "codex",
  authStatus: codexAuthStatus,
  providerChecks: codexProviderChecks,
  preflight,
  provider: codexProvider,
};

export type CodexDoctorReport = DoctorReport<CodexAuthStatus>;

/** Validate the installed integration while keeping all credential material private. */
export function runCodexDoctor(
  options: CodexProviderOptions = {},
  env: Record<string, string | undefined> = process.env,
): Promise<CodexDoctorReport> {
  return runDoctorFor(CODEX_DOCTOR, options, env);
}

export function formatCodexDoctorReport(report: CodexDoctorReport): string {
  return formatDoctorReport(CODEX_DOCTOR, report);
}

export { doctorPassed };
