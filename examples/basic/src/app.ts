import { setProvider } from "@flue/runtime";
import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";
import { codexProvider } from "flue-codex-oauth";
import { Assistant } from "./agents/assistant.ts";

setProvider(codexProvider());

const app = new Hono();
app.route("/agents/assistant", createAgentRouter(Assistant));

export default app;
