#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import {
  CLAUDE_PROVIDER_ID,
  writeClaudeAuthFileAtomic,
} from "../claude-credential-store.js";
import {
  claudeUsage,
  planClaudeAuthPath,
  planClaudeLogin,
} from "../claude-login-support.js";
import { loginClaudeCredentials } from "../claude-oauth.js";
import { runLoginCommand } from "../login-cli.js";

const interaction: AuthInteraction = {
  async prompt(prompt) {
    if (prompt.type !== "manual_code") {
      throw new Error("The Claude browser login requested unexpected user input.");
    }
    const readline = createInterface({ input: stdin, output: stdout });
    try {
      return await readline.question(
        `${prompt.message}\n> `,
        prompt.signal ? { signal: prompt.signal } : {},
      );
    } finally {
      readline.close();
    }
  },
  notify(event) {
    if (event.type === "auth_url") {
      console.log(`Open this authorization URL:\n${event.url}\n`);
      if (event.instructions) console.log(event.instructions);
    } else if (event.type === "progress") {
      console.log(event.message);
    }
  },
};

process.exitCode = await runLoginCommand({
  label: "Claude",
  providerId: CLAUDE_PROVIDER_ID,
  packageExportName: "claudeProvider",
  usage: claudeUsage,
  planAuthPath: planClaudeAuthPath,
  planLogin: planClaudeLogin,
  async loadDoctor() {
    const doctor = await import("../claude-doctor.js").catch(() => undefined);
    if (!doctor) return undefined;
    return {
      run: doctor.runClaudeDoctor,
      format: doctor.formatClaudeDoctorReport,
      passed: doctor.claudeDoctorPassed,
    };
  },
  login: () => loginClaudeCredentials(interaction),
  writeAuthFileAtomic: writeClaudeAuthFileAtomic,
});
