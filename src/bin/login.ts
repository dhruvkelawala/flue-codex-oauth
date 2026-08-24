#!/usr/bin/env node
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { codexOAuth } from "../codex-oauth.js";
import { CODEX_PROVIDER_ID, writeAuthFileAtomic } from "../codex-credential-store.js";
import { planAuthPath, planLogin, usage } from "../codex-login-support.js";
import { runLoginCommand } from "../login-cli.js";
import { withoutCredentialType } from "../oauth-credentials.js";

const interaction: AuthInteraction = {
  async prompt(prompt) {
    if (
      prompt.type === "select" &&
      prompt.options.some((option) => option.id === "device_code")
    ) {
      return "device_code";
    }
    throw new Error("The Codex device-code login requested unexpected user input.");
  },
  notify(event) {
    if (event.type === "device_code") {
      console.log(`Verification URI: ${event.verificationUri}`);
      console.log(`User code: ${event.userCode}`);
    }
  },
};

process.exitCode = await runLoginCommand({
  label: "Codex",
  providerId: CODEX_PROVIDER_ID,
  packageExportName: "codexProvider",
  usage,
  planAuthPath,
  planLogin,
  async loadDoctor() {
    const doctor = await import("../doctor.js").catch(() => undefined);
    if (!doctor) return undefined;
    return {
      run: doctor.runCodexDoctor,
      format: doctor.formatCodexDoctorReport,
      passed: doctor.doctorPassed,
    };
  },
  async login() {
    return withoutCredentialType(await codexOAuth().login(interaction));
  },
  writeAuthFileAtomic,
});
