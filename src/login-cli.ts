import { existsSync, promises as fsPromises } from "node:fs";
import { dirname } from "node:path";
import type { OAuthFileCredentials, OAuthAuthFile } from "./credential-store.js";
import type { LoginPlan, LoginPlanError } from "./login-support.js";

export interface LoginDoctorBridge<Report> {
  run(options: { authPath: string }): Promise<Report>;
  format(report: Report): string;
  passed(report: Report): boolean;
}

export interface LoginCommandConfig<Report = unknown> {
  label: string;
  providerId: string;
  packageExportName: string;
  usage(): string;
  planAuthPath(
    argv: string[],
    env: Record<string, string | undefined>,
    cwd: string,
  ): { authPath: string } | LoginPlanError;
  planLogin(
    argv: string[],
    env: Record<string, string | undefined>,
    cwd: string,
    fileExists: (p: string) => boolean,
  ): LoginPlan | LoginPlanError;
  loadDoctor(): Promise<LoginDoctorBridge<Report> | undefined>;
  login(): Promise<OAuthFileCredentials>;
  writeAuthFileAtomic(authPath: string, authFile: OAuthAuthFile): Promise<void>;
}

export async function runLoginCommand(config: LoginCommandConfig): Promise<number> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(config.usage());
    return 0;
  }

  if (args.includes("--doctor") || args.includes("--check")) {
    return runDoctorCommand(config, args);
  }

  const plan = config.planLogin(args, process.env, process.cwd(), existsSync);
  if ("error" in plan) {
    console.error(plan.error);
    console.error(config.usage());
    return 1;
  }

  const parentDir = dirname(plan.authPath);
  await fsPromises.mkdir(parentDir, { recursive: true, mode: 0o700 });
  await fsPromises.chmod(parentDir, 0o700);

  const credentials = await config.login();
  await config.writeAuthFileAtomic(plan.authPath, {
    provider: config.providerId,
    credentials,
    lastRefresh: new Date().toISOString(),
  });

  console.log(`${config.label} auth file written: ${plan.authPath}`);
  return 0;
}

async function runDoctorCommand(
  config: LoginCommandConfig,
  args: string[],
): Promise<number> {
  const plan = config.planAuthPath(args, process.env, process.cwd());
  if ("error" in plan) {
    console.error(plan.error);
    console.error(config.usage());
    return 1;
  }

  const runtimeName = "@flue/runtime";
  const runtimeImport = await import(runtimeName).catch(() => undefined);
  if (!runtimeImport || typeof runtimeImport.setProvider !== "function") {
    failDoctorCheck(
      config.label,
      "flue-runtime-integration",
      "A compatible Flue 2 @flue/runtime peer could not be loaded.",
    );
  }

  const packageName = "flue-codex-oauth";
  const packageImport = await import(packageName).catch(() => undefined);
  if (
    !packageImport ||
    typeof (packageImport as Record<string, unknown>)[config.packageExportName] !== "function"
  ) {
    failDoctorCheck(config.label, "package-import", "The package's public export could not be loaded.");
  }

  const doctor = await config.loadDoctor();
  if (!doctor) {
    failDoctorCheck(
      config.label,
      "package-install",
      "The installed doctor module could not be loaded.",
    );
  }

  const report = await doctor.run({ authPath: plan.authPath });
  process.stdout.write(doctor.format(report));
  return doctor.passed(report) ? 0 : 1;
}

function failDoctorCheck(label: string, name: string, message: string): never {
  console.error(`Flue ${label} OAuth doctor`);
  console.error(`FAIL ${name}: ${message}`);
  console.error("Doctor result: not ready");
  process.exit(1);
}
