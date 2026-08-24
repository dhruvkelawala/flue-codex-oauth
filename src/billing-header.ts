import { createHash } from "node:crypto";

export const DEFAULT_CLAUDE_CODE_VERSION = "2.1.96";
export const DEFAULT_ENTRYPOINT = "flue";
const BILLING_SALT = "59cf53e54c78";
const BILLING_PREFIX = "x-anthropic-billing-header:";
const BILLING_VERSION_SAMPLE_POSITIONS = [4, 7, 20] as const;
const BILLING_VERSION_HASH_LENGTH = 3;
const BILLING_CONTENT_HASH_LENGTH = 5;

export interface BillingHeaderOptions {
  version?: string;
  entrypoint?: string;
}

export interface PayloadLike {
  system?: unknown;
  messages?: unknown;
  [key: string]: unknown;
}

export function buildBillingHeader(
  messages: unknown,
  options: BillingHeaderOptions = {},
): string {
  const list = Array.isArray(messages) ? messages : [];
  const firstUser = list.find(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as { role?: unknown }).role === "user",
  ) as { content?: unknown } | undefined;
  const text = getBillingMessageText(firstUser?.content);
  const version = options.version ?? DEFAULT_CLAUDE_CODE_VERSION;
  const entrypoint = options.entrypoint ?? DEFAULT_ENTRYPOINT;
  const versionHashSample = BILLING_VERSION_SAMPLE_POSITIONS.map(
    (index) => text[index] ?? "0",
  ).join("");
  const versionHash = sha256(`${BILLING_SALT}${versionHashSample}${version}`).slice(
    0,
    BILLING_VERSION_HASH_LENGTH,
  );
  const conversationContentHash = sha256(text).slice(0, BILLING_CONTENT_HASH_LENGTH);
  return `${BILLING_PREFIX} cc_version=${version}.${versionHash}; cc_entrypoint=${entrypoint}; cch=${conversationContentHash};`;
}

export function ensureBillingHeader(
  payload: PayloadLike,
  options: BillingHeaderOptions = {},
): PayloadLike {
  const system = Array.isArray(payload.system)
    ? payload.system
    : typeof payload.system === "string"
      ? [{ type: "text", text: payload.system }]
      : [];
  if (system.some(isBillingBlock)) return payload;
  return {
    ...payload,
    system: [{ type: "text", text: buildBillingHeader(payload.messages, options) }, ...system],
  };
}

export function getBillingMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

export function isBillingBlock(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "text" &&
    typeof (value as { text?: unknown }).text === "string" &&
    (value as { text: string }).text.startsWith(BILLING_PREFIX)
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
