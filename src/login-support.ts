import { homedir } from "node:os";
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

/** CLI-facing labels and defaults for one login command. */
export interface LoginCliConfig {
  /** Human label used in messages, e.g. "Codex". */
  label: string;
  /** Installed bin name, e.g. "flue-codex-login". */
  binName: string;
  /** Environment variable that may hold the auth path. */
  authPathEnvName: string;
  /** Default auth path, e.g. "~/.flue/openai-codex.json". */
  defaultAuthPath: string;
  /** One-line flow description shown in usage output. */
  flowDescription: string;
}

/**
 * Pure decision function for a login CLI. `argv` excludes node/script.
 */
export function planLoginFor(
  cli: LoginCliConfig,
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string,
  fileExists: (p: string) => boolean,
): LoginPlan | LoginPlanError {
  const authPathPlan = planAuthPathFor(cli, argv, env, cwd);
  if ("error" in authPathPlan) return authPathPlan;
  const { authPath } = authPathPlan;

  const force = argv.includes("--force");
  if (fileExists(authPath) && !force) {
    return {
      error: `${cli.label} auth file already exists: ${authPath}. Re-run with --force to overwrite.`,
    };
  }

  return { authPath, force };
}

/** Resolve and validate the shared auth path for login and doctor commands. */
export function planAuthPathFor(
  cli: LoginCliConfig,
  argv: string[],
  env: Record<string, string | undefined>,
  cwd: string,
): { authPath: string } | LoginPlanError {
  const parsedAuthPath = optionValue(argv, "--auth-path");
  if ("error" in parsedAuthPath) return parsedAuthPath;

  const rawAuthPath =
    parsedAuthPath.value ?? clean(env[cli.authPathEnvName]) ?? cli.defaultAuthPath;
  const expandedAuthPath = expandHome(rawAuthPath);

  if (!isAbsolute(expandedAuthPath)) {
    return { error: `${cli.label} auth path must be absolute after expanding '~'.` };
  }

  const authPath = resolve(expandedAuthPath);
  if (!isHomeDirectory(cwd) && isPathInside(cwd, authPath)) {
    return {
      error: `Refusing to use ${cli.label} auth inside the project directory: ${authPath}`,
    };
  }

  return { authPath };
}

export function usageFor(cli: LoginCliConfig): string {
  const authFileName = cli.defaultAuthPath.split("/").pop() ?? "auth.json";
  return `Usage: ${cli.binName} [--auth-path /path/to/${authFileName}] [--force]
       ${cli.binName} --doctor [--auth-path /path/to/${authFileName}]

${cli.flowDescription}
Use --doctor (or --check) to validate an existing integration without printing tokens.

Auth path resolution order:
  1. --auth-path <path>
  2. ${cli.authPathEnvName}
  3. ${cli.defaultAuthPath}

Options:
  --auth-path <path>  Absolute auth file path. A leading ~/ is expanded.
  --doctor, --check   Validate auth, refresh, environment, and runtime integration.
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

function isHomeDirectory(path: string): boolean {
  return resolve(path) === resolve(homedir());
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
