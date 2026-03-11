import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getAllRecords, getSummary } from "./store.js";

/**
 * Registers gateway RPC methods so WebSocket clients (CLI, other plugins)
 * can query subagent data directly.
 */
export function registerGatewayMethods(api: OpenClawPluginApi): void {
  api.registerGatewayMethod(
    "subagents.list",
    (opts: any) => {
      try {
        const records = getAllRecords();
        opts.respond(true, { subagents: records });
      } catch (err) {
        opts.respond(false, undefined, {
          code: "FETCH_ERROR",
          message: String(err),
        });
      }
    },
  );

  api.registerGatewayMethod(
    "subagents.summary",
    (opts: any) => {
      try {
        const summary = getSummary();
        opts.respond(true, summary);
      } catch (err) {
        opts.respond(false, undefined, {
          code: "FETCH_ERROR",
          message: String(err),
        });
      }
    },
  );
}
