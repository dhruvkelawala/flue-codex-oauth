"use agent";

import { useModel } from "@flue/runtime";

export function ClaudeAssistant() {
  useModel("anthropic/claude-sonnet-4-6");
  return "You are a helpful assistant.";
}
