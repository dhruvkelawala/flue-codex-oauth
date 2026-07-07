#!/usr/bin/env node
import { existsSync, promises as fsPromises } from "node:fs";
import { dirname } from "node:path";
import { loginOpenAICodexDeviceCode } from "@earendil-works/pi-ai/oauth";
import { writeAuthFileAtomic } from "../credential-store.js";
import { planLogin, usage } from "../login-support.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage());
  process.exit(0);
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

const credentials = await loginOpenAICodexDeviceCode({
  onDeviceCode(info) {
    console.log(`Verification URI: ${info.verificationUri}`);
    console.log(`User code: ${info.userCode}`);
  },
});

await writeAuthFileAtomic(plan.authPath, {
  provider: "openai-codex",
  credentials,
  lastRefresh: new Date().toISOString(),
});

console.log(`Codex auth file written: ${plan.authPath}`);
