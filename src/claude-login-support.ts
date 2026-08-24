import { CLAUDE_DEFAULT_AUTH_PATH } from "./claude-credential-store.js";
import {
  planAuthPathFor,
  planLoginFor,
  usageFor,
  type LoginCliConfig,
  type LoginPlan,
  type LoginPlanError,
} from "./login-support.js";

export { CLAUDE_DEFAULT_AUTH_PATH } from "./claude-credential-store.js";
export type { LoginPlan, LoginPlanError } from "./login-support.js";

export const CLAUDE_LOGIN_CLI: LoginCliConfig = {
  label: "Claude",
  binName: "flue-claude-login",
  authPathEnvName: "FLUE_CLAUDE_AUTH_PATH",
  defaultAuthPath: CLAUDE_DEFAULT_AUTH_PATH,
  flowDescription:
    "Runs the Claude Pro/Max browser OAuth flow and writes a local auth file.",
};

export function planClaudeLogin(
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string,
  fileExists: (p: string) => boolean,
): LoginPlan | LoginPlanError {
  return planLoginFor(CLAUDE_LOGIN_CLI, argv, env, cwd, fileExists);
}

export function planClaudeAuthPath(
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string,
): { authPath: string } | LoginPlanError {
  return planAuthPathFor(CLAUDE_LOGIN_CLI, argv, env, cwd);
}

export function claudeUsage(): string {
  return usageFor(CLAUDE_LOGIN_CLI);
}
