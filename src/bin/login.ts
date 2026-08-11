#!/usr/bin/env node
import { existsSync, promises as fsPromises } from "node:fs";
import { dirname } from "node:path";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { writeAuthFileAtomic } from "../credential-store.js";
import { planAuthPath, planLogin, usage } from "../login-support.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

if (args.includes("--doctor") || args.includes("--check")) {
  const plan = planAuthPath(args, process.env, process.cwd());
  if ("error" in plan) {
    console.error(plan.error);
    console.error(usage());
    process.exit(1);
  }

  const runtimeName = "@flue/runtime";
  const runtimeImport = await import(runtimeName).catch(() => undefined);
  if (!runtimeImport || typeof runtimeImport.setProvider !== "function") {
    failDoctorCheck(
      "flue-runtime-integration",
      "A compatible Flue 2 @flue/runtime peer could not be loaded.",
    );
  }

  const packageName = "flue-codex-oauth";
  const packageImport = await import(packageName).catch(() => undefined);
  if (!packageImport || typeof packageImport.codexProvider !== "function") {
    failDoctorCheck("package-import", "The package's public export could not be loaded.");
  }

  const doctor = await import("../doctor.js").catch(() => undefined);
  if (!doctor) {
    failDoctorCheck("package-install", "The installed doctor module could not be loaded.");
  }

  const report = await doctor.runCodexDoctor({ authPath: plan.authPath });
  process.stdout.write(doctor.formatCodexDoctorReport(report));
  process.exit(doctor.doctorPassed(report) ? 0 : 1);
}

const plan = planLogin(args, process.env, process.cwd(), existsSync);
if ("error" in plan) {
  console.error(plan.error);
  console.error(usage());
  process.exit(1);
}

const parentDir = dirname(plan.authPath);
await fsPromises.mkdir(parentDir, { recursive: true, mode: 0o700 });
await fsPromises.chmod(parentDir, 0o700);

const oauth = openaiCodexProvider().auth.oauth;
if (!oauth) throw new Error("Pi openai-codex provider does not expose OAuth login.");

const interaction: AuthInteraction = {
  async prompt(prompt) {
    if (prompt.type === "select") return "device_code";
    throw new Error("The Codex device-code login requested unexpected user input.");
  },
  notify(event) {
    if (event.type === "device_code") {
      console.log(`Verification URI: ${event.verificationUri}`);
      console.log(`User code: ${event.userCode}`);
    }
  },
};
const { type: _type, ...credentials } = await oauth.login(interaction);

await writeAuthFileAtomic(plan.authPath, {
  provider: "openai-codex",
  credentials,
  lastRefresh: new Date().toISOString(),
});

console.log(`Codex auth file written: ${plan.authPath}`);

function failDoctorCheck(name: string, message: string): never {
  console.error("Flue Codex OAuth doctor");
  console.error(`FAIL ${name}: ${message}`);
  console.error("Doctor result: not ready");
  process.exit(1);
}
