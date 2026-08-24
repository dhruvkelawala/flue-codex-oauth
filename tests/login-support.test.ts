import { homedir } from "node:os";
import { join } from "node:path";
import { describe } from "vitest";
import {
  DEFAULT_AUTH_PATH,
  planAuthPath,
  planLogin,
  usage,
} from "../src/codex-login-support.ts";
import { runLoginSupportCases } from "./login-support-cases.ts";

describe("login support", () => {
  runLoginSupportCases({
    envName: "FLUE_CODEX_AUTH_PATH",
    defaultAuthPath: DEFAULT_AUTH_PATH,
    defaultResolvedPath: join(homedir(), ".flue/openai-codex.json"),
    homeFileName: "codex.json",
    cwdPrefix: "flue-codex-login-cwd",
    outsidePrefix: "flue-codex-login",
    insideFileName: "openai-codex.json",
    usageExpected: ["--auth-path", "--force", "--doctor", "FLUE_CODEX_AUTH_PATH"],
    planLogin,
    planAuthPath,
    usage,
  });
});
