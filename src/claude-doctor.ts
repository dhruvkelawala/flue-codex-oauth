import {
  claudeAuthStatus,
  claudePreflight,
  claudeProvider,
  claudeProviderChecks,
  type ClaudeProviderOptions,
} from "./claude-provider.js";
import type { ClaudeAuthStatus } from "./claude-credential-store.js";
import {
  doctorPassed,
  formatDoctorReport,
  runDoctorFor,
  type DoctorConfig,
  type DoctorReport,
} from "./doctor-support.js";

const CLAUDE_DOCTOR: DoctorConfig<ClaudeProviderOptions, ClaudeAuthStatus> = {
  title: "Flue Claude OAuth doctor",
  label: "Claude",
  checkPrefix: "claude",
  authStatus: claudeAuthStatus,
  providerChecks: claudeProviderChecks,
  preflight: claudePreflight,
  provider: claudeProvider,
};

export type ClaudeDoctorReport = DoctorReport<ClaudeAuthStatus>;

/** Validate the installed integration while keeping all credential material private. */
export function runClaudeDoctor(
  options: ClaudeProviderOptions = {},
  env: Record<string, string | undefined> = process.env,
): Promise<ClaudeDoctorReport> {
  return runDoctorFor(CLAUDE_DOCTOR, options, env);
}

export function formatClaudeDoctorReport(report: ClaudeDoctorReport): string {
  return formatDoctorReport(CLAUDE_DOCTOR, report);
}

export { doctorPassed as claudeDoctorPassed };
