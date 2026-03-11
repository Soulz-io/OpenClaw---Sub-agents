import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createHttpHandler } from "./src/http-handler.js";
import { registerGatewayMethods } from "./src/gateway-methods.js";
import { registerControlUiInjector } from "./src/control-ui-injector.js";
import { recordSpawned, recordEnded } from "./src/store.js";

const plugin = {
  id: "openclaw-subagents",
  name: "Subagents Dashboard",
  description:
    "Control UI tab showing all spawned sub-agents with prompts, status, and token usage.",

  register(api: OpenClawPluginApi) {
    const pluginRoot = path.dirname(
      typeof __filename !== "undefined"
        ? __filename
        : new URL(import.meta.url).pathname,
    );
    const uiRoot = path.resolve(pluginRoot, "ui");

    // ── Hooks: track subagent lifecycle ──────────────────────────
    api.on("subagent_spawned", (event) => {
      recordSpawned({
        runId: event.runId,
        childSessionKey: event.childSessionKey,
        agentId: event.agentId,
        label: event.label,
        mode: event.mode,
      });
    });

    api.on("subagent_ended", (event) => {
      recordEnded({
        runId: event.runId,
        targetSessionKey: event.targetSessionKey,
        outcome: event.outcome,
        error: event.error,
        endedAt: event.endedAt,
      });
    });

    // ── Soulz config ──────────────────────────────────────────────
    const pluginCfg = (api.pluginConfig || {}) as Record<string, unknown>;
    const soulzApiUrl = (pluginCfg.soulzApiUrl as string) || "http://localhost:3000";
    const soulzApiKey = (pluginCfg.soulzApiKey as string) || "";

    // ── HTTP handler: dashboard UI + API ─────────────────────────
    // Using registerHttpHandler (not registerHttpRoute) for prefix matching
    // of /plugins/openclaw-subagents/* paths
    api.registerHttpHandler(
      createHttpHandler({
        logger: api.logger,
        uiRoot,
        soulzApiUrl,
        soulzApiKey,
        runtime: api.runtime,
      }),
    );

    // Gateway RPC methods for WebSocket consumers
    registerGatewayMethods(api);

    // ── Inject Subagents tab into Control UI ──────────────────────
    // Intercepts GET / to inject <script> tag — no file copying needed
    registerControlUiInjector({ api });

    api.logger.info("Subagents Dashboard plugin registered");
  },
};

export default plugin;
