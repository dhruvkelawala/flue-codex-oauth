import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_AUTH_PATH, planLogin, usage, type LoginPlan } from "../src/login-support.ts";

describe("login support", () => {
  it("resolves --auth-path before env before the default path", () => {
    const cwd = fakeCwd();
    const flagPath = outsidePath("flag.json");
    const envPath = outsidePath("env.json");

    expect(
      expectPlan(
        planLogin(["--auth-path", flagPath], { FLUE_CODEX_AUTH_PATH: envPath }, cwd, neverExists),
      ).authPath,
    ).toBe(flagPath);
    expect(
      expectPlan(planLogin([], { FLUE_CODEX_AUTH_PATH: envPath }, cwd, neverExists)).authPath,
    ).toBe(envPath);
    expect(expectPlan(planLogin([], {}, cwd, neverExists)).authPath).toBe(
      join(homedir(), ".flue/openai-codex.json"),
    );
  });

  it("expands ~/ paths under the user's home directory", () => {
    const plan = expectPlan(planLogin(["--auth-path", "~/codex.json"], {}, fakeCwd(), neverExists));

    expect(plan.authPath).toBe(join(homedir(), "codex.json"));
    expect(isAbsolute(plan.authPath)).toBe(true);
  });

  it("rejects relative auth paths", () => {
    expect(expectError(planLogin(["--auth-path", "./x"], {}, fakeCwd(), neverExists))).toContain(
      "absolute",
    );
  });

  it("rejects auth paths inside the current working directory", () => {
    const cwd = fakeCwd();
    const authPath = join(cwd, "auth", "openai-codex.json");

    const error = expectError(planLogin(["--auth-path", authPath], {}, cwd, neverExists));

    expect(error).toContain("inside the project directory");
    expect(error).toContain(authPath);
  });

  it("requires --force before overwriting an existing auth file", () => {
    const authPath = outsidePath("existing.json");
    const fileExists = (path: string) => path === authPath;

    expect(expectError(planLogin(["--auth-path", authPath], {}, fakeCwd(), fileExists))).toContain(
      "already exists",
    );

    const plan = expectPlan(
      planLogin(["--auth-path", authPath, "--force"], {}, fakeCwd(), fileExists),
    );
    expect(plan.authPath).toBe(authPath);
    expect(plan.force).toBe(true);
  });

  it("describes supported flags and path resolution", () => {
    const text = usage();

    expect(text).toContain("--auth-path");
    expect(text).toContain("--force");
    expect(text).toContain("FLUE_CODEX_AUTH_PATH");
    expect(text).toContain(DEFAULT_AUTH_PATH);
  });
});

function fakeCwd(): string {
  return join(tmpdir(), "flue-codex-login-cwd");
}

function outsidePath(name: string): string {
  return join(tmpdir(), `flue-codex-login-${name}`);
}

function neverExists(): boolean {
  return false;
}

function expectPlan(result: ReturnType<typeof planLogin>): LoginPlan {
  expect("error" in result).toBe(false);
  return result as LoginPlan;
}

function expectError(result: ReturnType<typeof planLogin>): string {
  expect("error" in result).toBe(true);
  return "error" in result ? result.error : "";
}
