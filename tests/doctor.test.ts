import { beforeEach, describe, vi } from "vitest";
import {
  doctorPassed,
  formatCodexDoctorReport,
  runCodexDoctor,
} from "../src/doctor.ts";
import { createAuthFile } from "./auth-fixture.ts";
import { runDoctorCases } from "./doctor-cases.ts";

const { setProvider } = vi.hoisted(() => ({ setProvider: vi.fn() }));
vi.mock("@flue/runtime", () => ({ setProvider }));

describe("Codex OAuth doctor", () => {
  beforeEach(() => setProvider.mockReset());

  runDoctorCases({
    label: "Codex",
    checkPrefix: "codex",
    providerId: "openai-codex",
    unsafeEnvName: "CODEX_ACCESS_TOKEN",
    setProvider,
    createAuthFile,
    runDoctor: runCodexDoctor,
    formatReport: formatCodexDoctorReport,
    passed: doctorPassed,
  });
});
