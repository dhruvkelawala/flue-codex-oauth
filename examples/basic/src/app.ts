import { codexAuth } from "flue-codex-oauth";
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

const codex = codexAuth(); // defaults: ~/.flue/openai-codex.json

await codex.configure(); // startup: refresh if stale, registerProvider("openai-codex", ...)

const app = new Hono();

app.use("*", codex.middleware()); // keep the registered token fresh per request

app.route("/", flue());

export default app;
