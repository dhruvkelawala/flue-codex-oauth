import { CODEX_DEFAULT_AUTH_PATH } from "./codex-credential-store.js";
import {
  planAuthPathFor,
  planLoginFor,
  usageFor,
  type LoginCliConfig,
  type LoginPlan,
  type LoginPlanError,
} from "./login-support.js";

export type { LoginPlan, LoginPlanError } from "./login-support.js";

export const CODEX_LOGIN_CLI: LoginCliConfig = {
  label: "Codex",
  binName: "flue-codex-login",
  authPathEnvName: "FLUE_CODEX_AUTH_PATH",
  defaultAuthPath: CODEX_DEFAULT_AUTH_PATH,
  flowDescription: "Runs the OpenAI Codex device-code flow and writes a local auth file.",
};

export const DEFAULT_AUTH_PATH = CODEX_LOGIN_CLI.defaultAuthPath;

export function planLogin(
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string,
  fileExists: (p: string) => boolean,
): LoginPlan | LoginPlanError {
  return planLoginFor(CODEX_LOGIN_CLI, argv, env, cwd, fileExists);
}

export function planAuthPath(
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string,
): { authPath: string } | LoginPlanError {
  return planAuthPathFor(CODEX_LOGIN_CLI, argv, env, cwd);
}

export function usage(): string {
  return usageFor(CODEX_LOGIN_CLI);
}
