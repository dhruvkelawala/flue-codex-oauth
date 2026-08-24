"use agent";

import { useModel } from "@flue/runtime";

export function Assistant() {
  useModel("openai-codex/gpt-5.5");
  return "You are a helpful assistant.";
}
