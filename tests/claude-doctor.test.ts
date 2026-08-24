import { afterEach, beforeEach, describe, vi } from "vitest";
import {
  claudeDoctorPassed,
  formatClaudeDoctorReport,
  runClaudeDoctor,
} from "../src/claude-doctor.ts";
import { CLAUDE_AUTH_ENV_NAMES } from "../src/env-hygiene.ts";
import { createClaudeAuthFile } from "./auth-fixture.ts";
import { runDoctorCases } from "./doctor-cases.ts";

const { setProvider } = vi.hoisted(() => ({ setProvider: vi.fn() }));
vi.mock("@flue/runtime", () => ({ setProvider }));

describe("Claude OAuth doctor", () => {
  beforeEach(() => {
    setProvider.mockReset();
    for (const name of CLAUDE_AUTH_ENV_NAMES) vi.stubEnv(name, "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  runDoctorCases({
    label: "Claude",
    checkPrefix: "claude",
    providerId: "anthropic",
    unsafeEnvName: "CLAUDE_ACCESS_TOKEN",
    setProvider,
    createAuthFile: createClaudeAuthFile,
    runDoctor: runClaudeDoctor,
    formatReport: formatClaudeDoctorReport,
    passed: claudeDoctorPassed,
  });
});
