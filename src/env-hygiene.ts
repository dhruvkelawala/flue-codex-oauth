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

const CLAUDE_OAUTH_TOKEN_PREFIX = "sk-ant-oat";

export const CLAUDE_AUTH_ENV_NAMES = [
  "ANTHROPIC_ACCESS_TOKEN",
  "ANTHROPIC_REFRESH_TOKEN",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
  "CLAUDE_ACCESS_TOKEN",
  "CLAUDE_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "FLUE_CLAUDE_AUTH_JSON",
  "FLUE_CLAUDE_ACCESS_TOKEN",
  "FLUE_CLAUDE_REFRESH_TOKEN",
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
  const unsafeNames = unsafeEnvNames(env, CODEX_AUTH_ENV_NAMES, extraRejectedNames);

  return [
    {
      name: "codex-no-env-credentials",
      ok: unsafeNames.length === 0,
      severity: "error",
      message: `Remove app-visible Codex OAuth material from ${unsafeNames.join(", ") || "<none>"}.`,
    },
  ];
}

export function checkClaudeEnvHygiene(
  env: Record<string, string | undefined>,
  extraRejectedNames: string[] = [],
): AuthCheck[] {
  const unsafeNames = unsafeEnvNames(env, CLAUDE_AUTH_ENV_NAMES, extraRejectedNames);

  // A Claude subscription OAuth token in ANTHROPIC_API_KEY would silently take
  // over billing-sensitive requests; plain API keys are allowed there.
  const apiKey = env.ANTHROPIC_API_KEY;
  if (
    apiKey !== undefined &&
    apiKey.includes(CLAUDE_OAUTH_TOKEN_PREFIX) &&
    !isPlaceholderCredential(apiKey) &&
    !unsafeNames.includes("ANTHROPIC_API_KEY")
  ) {
    unsafeNames.push("ANTHROPIC_API_KEY");
  }

  return [
    {
      name: "claude-no-env-credentials",
      ok: unsafeNames.length === 0,
      severity: "error",
      message: `Remove app-visible Claude OAuth material from ${unsafeNames.join(", ") || "<none>"}.`,
    },
  ];
}

function unsafeEnvNames(
  env: Record<string, string | undefined>,
  builtinNames: readonly string[],
  extraRejectedNames: string[],
): string[] {
  const rejectedNames = [...new Set([...builtinNames, ...extraRejectedNames])];
  return rejectedNames.filter((name) => {
    const value = env[name];
    return value !== undefined && value.trim() !== "" && !isPlaceholderCredential(value);
  });
}
