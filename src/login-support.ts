import { isAbsolute, relative, resolve } from "node:path";
import { expandHome } from "./credential-store.js";

export interface LoginPlan {
  /** Absolute, home-expanded auth file path. */
  authPath: string;
  force: boolean;
}

export interface LoginPlanError {
  error: string;
}

export const DEFAULT_AUTH_PATH = "~/.flue/openai-codex.json";

/**
 * Pure decision function for the login CLI. `argv` excludes node/script.
 */
export function planLogin(
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string,
  fileExists: (p: string) => boolean,
): LoginPlan | LoginPlanError {
  const parsedAuthPath = optionValue(argv, "--auth-path");
  if ("error" in parsedAuthPath) return parsedAuthPath;

  const rawAuthPath =
    parsedAuthPath.value ?? clean(env.FLUE_CODEX_AUTH_PATH) ?? DEFAULT_AUTH_PATH;
  const expandedAuthPath = expandHome(rawAuthPath);

  if (!isAbsolute(expandedAuthPath)) {
    return { error: "Codex auth path must be absolute after expanding '~'." };
  }

  const authPath = resolve(expandedAuthPath);
  if (isPathInside(cwd, authPath)) {
    return {
      error: `Refusing to write Codex auth inside the project directory: ${authPath}`,
    };
  }

  const force = argv.includes("--force");
  if (fileExists(authPath) && !force) {
    return {
      error: `Codex auth file already exists: ${authPath}. Re-run with --force to overwrite.`,
    };
  }

  return { authPath, force };
}

export function usage(): string {
  return `Usage: flue-codex-login [--auth-path /path/to/openai-codex.json] [--force]

Runs the OpenAI Codex device-code flow and writes a local auth file.

Auth path resolution order:
  1. --auth-path <path>
  2. FLUE_CODEX_AUTH_PATH
  3. ${DEFAULT_AUTH_PATH}

Options:
  --auth-path <path>  Absolute auth file path. A leading ~/ is expanded.
  --force             Overwrite an existing auth file.
  --help, -h          Show this help.
`;
}

function optionValue(
  argv: string[],
  name: string,
): { value: string | undefined } | LoginPlanError {
  const equalsPrefix = `${name}=`;
  const equalsArg = argv.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsArg) return { value: equalsArg.slice(equalsPrefix.length) };

  const index = argv.indexOf(name);
  if (index === -1) return { value: undefined };

  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return { error: `${name} requires a path value.` };
  }

  return { value };
}

function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child));
  return (
    relativePath === "" ||
    (!!relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
