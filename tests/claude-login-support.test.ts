import { homedir } from "node:os";
import { join } from "node:path";
import { describe } from "vitest";
import {
  CLAUDE_DEFAULT_AUTH_PATH,
  claudeUsage,
  planClaudeAuthPath,
  planClaudeLogin,
} from "../src/claude-login-support.ts";
import { runLoginSupportCases } from "./login-support-cases.ts";

describe("claude login support", () => {
  runLoginSupportCases({
    envName: "FLUE_CLAUDE_AUTH_PATH",
    defaultAuthPath: CLAUDE_DEFAULT_AUTH_PATH,
    defaultResolvedPath: join(homedir(), ".flue/anthropic.json"),
    homeFileName: "claude.json",
    cwdPrefix: "flue-claude-login-cwd",
    outsidePrefix: "flue-claude-login",
    insideFileName: "anthropic.json",
    usageExpected: [
      "flue-claude-login",
      "--auth-path",
      "--force",
      "--doctor",
      "FLUE_CLAUDE_AUTH_PATH",
    ],
    planLogin: planClaudeLogin,
    planAuthPath: planClaudeAuthPath,
    usage: claudeUsage,
  });
});
