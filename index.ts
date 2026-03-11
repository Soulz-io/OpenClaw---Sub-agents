import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createHttpHandler } from "./src/http-handler.js";
import { registerGatewayMethods } from "./src/gateway-methods.js";
import { setupControlUiPatch } from "./src/tab-injector.js";
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

    // ── HTTP routes: dashboard UI + API ─────────────────────────
    api.registerHttpRoute({
      path: "/plugins/openclaw-subagents",
      auth: "plugin",
      match: "prefix",
      handler: createHttpHandler({ logger: api.logger, uiRoot }),
    });

    // Gateway RPC methods for WebSocket consumers
    registerGatewayMethods(api);

    // Patch Control UI to inject the Subagents tab
    setupControlUiPatch({ logger: api.logger });

    api.logger.info("Subagents Dashboard plugin registered");
  },
};

export default plugin;
