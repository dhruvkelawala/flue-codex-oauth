import { setProvider } from "@flue/runtime";
import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";
import { claudeProvider, codexProvider } from "flue-codex-oauth";
import { Assistant } from "./agents/assistant.ts";
import { ClaudeAssistant } from "./agents/claude-assistant.ts";

setProvider(codexProvider());
setProvider(claudeProvider());

const app = new Hono();
app.route("/agents/assistant", createAgentRouter(Assistant));
app.route("/agents/claude-assistant", createAgentRouter(ClaudeAssistant));

export default app;
