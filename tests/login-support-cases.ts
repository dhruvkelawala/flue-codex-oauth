import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expect, it } from "vitest";
import type { LoginPlan } from "../src/login-support.ts";

interface LoginSupportCaseConfig {
  envName: string;
  defaultAuthPath: string;
  defaultResolvedPath: string;
  homeFileName: string;
  cwdPrefix: string;
  outsidePrefix: string;
  insideFileName: string;
  usageExpected: string[];
  planLogin: (
    argv: string[],
    env: Record<string, string | undefined>,
    cwd: string,
    exists: (path: string) => boolean,
  ) => LoginPlan | { error: string };
  planAuthPath: (
    argv: string[],
    env: Record<string, string | undefined>,
    cwd: string,
  ) => { authPath: string } | { error: string };
  usage: () => string;
}

export function runLoginSupportCases(config: LoginSupportCaseConfig): void {
  it("resolves --auth-path before env before the default path", () => {
    const cwd = fakeCwd(config);
    const flagPath = outsidePath(config, "flag.json");
    const envPath = outsidePath(config, "env.json");

    expect(
      expectPlan(
        config.planLogin(["--auth-path", flagPath], { [config.envName]: envPath }, cwd, neverExists),
      ).authPath,
    ).toBe(flagPath);
    expect(
      expectPlan(config.planLogin([], { [config.envName]: envPath }, cwd, neverExists)).authPath,
    ).toBe(envPath);
    expect(expectPlan(config.planLogin([], {}, cwd, neverExists)).authPath).toBe(
      config.defaultResolvedPath,
    );
  });

  it("expands ~/ paths under the user's home directory", () => {
    const plan = expectPlan(
      config.planLogin(["--auth-path", `~/${config.homeFileName}`], {}, fakeCwd(config), neverExists),
    );

    expect(plan.authPath).toBe(join(homedir(), config.homeFileName));
    expect(isAbsolute(plan.authPath)).toBe(true);
  });

  it("allows the default home auth path when launched from the home directory", () => {
    const plan = expectPlan(config.planLogin([], {}, homedir(), neverExists));

    expect(plan.authPath).toBe(config.defaultResolvedPath);
  });

  it("rejects relative auth paths", () => {
    expect(
      expectError(config.planLogin(["--auth-path", "./x"], {}, fakeCwd(config), neverExists)),
    ).toContain("absolute");
  });

  it("rejects auth paths inside the current working directory", () => {
    const cwd = fakeCwd(config);
    const authPath = join(cwd, "auth", config.insideFileName);

    const error = expectError(config.planLogin(["--auth-path", authPath], {}, cwd, neverExists));

    expect(error).toContain("inside the project directory");
    expect(error).toContain(authPath);
  });

  it("requires --force before overwriting an existing auth file", () => {
    const authPath = outsidePath(config, "existing.json");
    const fileExists = (path: string) => path === authPath;

    expect(
      expectError(config.planLogin(["--auth-path", authPath], {}, fakeCwd(config), fileExists)),
    ).toContain("already exists");

    const plan = expectPlan(
      config.planLogin(["--auth-path", authPath, "--force"], {}, fakeCwd(config), fileExists),
    );
    expect(plan.authPath).toBe(authPath);
    expect(plan.force).toBe(true);
  });

  it("describes supported flags and path resolution", () => {
    const text = config.usage();

    for (const expected of config.usageExpected) expect(text).toContain(expected);
    expect(text).toContain(config.defaultAuthPath);
  });

  it("resolves an existing auth path for doctor without requiring --force", () => {
    const authPath = outsidePath(config, "doctor.json");

    expect(config.planAuthPath(["--doctor", "--auth-path", authPath], {}, fakeCwd(config))).toEqual({
      authPath,
    });
  });
}

function fakeCwd(config: LoginSupportCaseConfig): string {
  return join(tmpdir(), config.cwdPrefix);
}

function outsidePath(config: LoginSupportCaseConfig, name: string): string {
  return join(tmpdir(), `${config.outsidePrefix}-${name}`);
}

function neverExists(): boolean {
  return false;
}

function expectPlan(result: LoginPlan | { error: string }): LoginPlan {
  expect("error" in result).toBe(false);
  return result as LoginPlan;
}

function expectError(result: LoginPlan | { error: string }): string {
  expect("error" in result).toBe(true);
  return "error" in result ? result.error : "";
}
