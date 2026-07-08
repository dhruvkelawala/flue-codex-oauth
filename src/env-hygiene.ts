import type { AuthCheck } from "./credential-store.js";

export const CODEX_AUTH_ENV_NAMES = [
  "OPENAI_CODEX_AUTH_JSON",
  "OPENAI_CODEX_AUTH_FILE",
  "OPENAI_CODEX_ACCESS_TOKEN",
  "OPENAI_CODEX_REFRESH_TOKEN",
  "OPENAI_CODEX_ID_TOKEN",
  "CODEX_AUTH_JSON",
  "CODEX_AUTH_FILE",
  "CODEX_ACCESS_TOKEN",
  "CODEX_REFRESH_TOKEN",
] as const;

export function isPlaceholderCredential(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  return /^PH_[A-Za-z0-9._:-]+$/.test(trimmed) || /placeholder/i.test(trimmed);
}

export function checkEnvHygiene(
  env: Record<string, string | undefined>,
  extraRejectedNames: string[] = [],
): AuthCheck[] {
  const rejectedNames = [...new Set([...CODEX_AUTH_ENV_NAMES, ...extraRejectedNames])];
  const unsafeNames = rejectedNames.filter((name) => {
    const value = env[name];
    return value !== undefined && value.trim() !== "" && !isPlaceholderCredential(value);
  });

  return [
    {
      name: "codex-no-env-credentials",
      ok: unsafeNames.length === 0,
      severity: "error",
      message: `Remove app-visible Codex OAuth material from ${unsafeNames.join(", ") || "<none>"}.`,
    },
  ];
}
