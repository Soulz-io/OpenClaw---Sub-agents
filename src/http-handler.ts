import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAllRecords, getSummary } from "./store.js";

interface PluginLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

interface HttpHandlerParams {
  logger?: PluginLogger;
  uiRoot: string;
  soulzApiUrl: string;
  soulzApiKey: string;
  runtime: any;
}

const PREFIX = "/plugins/openclaw-subagents";
const API_PREFIX = `${PREFIX}/api/`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * Serves the subagent dashboard UI and API endpoints.
 *
 * API routes:
 *   GET /api/subagents  — list all subagent run records
 *   GET /api/summary    — aggregate stats
 *
 * The API reads directly from the in-process subagent registry
 * via dynamic import of openclaw internals.
 */
export function createHttpHandler(params: HttpHandlerParams) {
  const { logger, uiRoot, soulzApiUrl, soulzApiKey, runtime } = params;

  return async function handler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // ── Only handle our plugin prefix ────────────────────────────
    if (!pathname.startsWith(PREFIX)) return false;

    // ── API routes ──────────────────────────────────────────────
    if (pathname.startsWith(API_PREFIX)) {
      const route = pathname.slice(API_PREFIX.length).replace(/\/$/, "");

      if (route === "subagents" && req.method === "GET") {
        return handleListSubagents(res, logger);
      }
      if (route === "summary" && req.method === "GET") {
        return handleSummary(res, logger);
      }
      if (route === "spawn" && req.method === "POST") {
        return handleSpawn(req, res, { soulzApiUrl, soulzApiKey, runtime, logger });
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found" }));
      return true;
    }

    // ── Injector script (served from ui/) ───────────────────────
    if (pathname === `${PREFIX}/injector.js`) {
      return serveFile(path.join(uiRoot, "injector.js"), ".js", res);
    }

    // ── Static UI files ─────────────────────────────────────────
    let relPath = pathname.slice(PREFIX.length) || "/";
    if (relPath === "/") relPath = "/index.html";

    // Prevent path traversal
    const resolved = path.resolve(uiRoot, relPath.slice(1));
    if (!resolved.startsWith(path.resolve(uiRoot))) {
      res.statusCode = 403;
      res.end("Forbidden");
      return true;
    }

    const ext = path.extname(resolved);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return serveFile(resolved, ext, res);
    }

    // SPA fallback
    return serveFile(path.join(uiRoot, "index.html"), ".html", res);
  };
}

function handleListSubagents(
  res: ServerResponse,
  logger?: PluginLogger,
): boolean {
  try {
    const records = getAllRecords();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(records));
  } catch (err) {
    logger?.warn?.(`[openclaw-subagents] API error: ${err}`);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err) }));
  }
  return true;
}

function handleSummary(
  res: ServerResponse,
  logger?: PluginLogger,
): boolean {
  try {
    const summary = getSummary();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(summary));
  } catch (err) {
    logger?.warn?.(`[openclaw-subagents] Summary error: ${err}`);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err) }));
  }
  return true;
}

async function handleSpawn(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { soulzApiUrl: string; soulzApiKey: string; runtime: any; logger?: PluginLogger },
): Promise<boolean> {
  const { soulzApiUrl, soulzApiKey, runtime, logger } = opts;

  // Read request body
  let body: Record<string, unknown>;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Invalid JSON body." }));
    return true;
  }

  const category = typeof body.category === "string" ? body.category : "";
  const specialism = typeof body.specialism === "string" ? body.specialism : undefined;
  const styleTheme = typeof body.style_theme === "string" ? body.style_theme : undefined;
  const taskDescription = typeof body.task_description === "string" ? body.task_description : undefined;

  if (!category) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Missing required field: category." }));
    return true;
  }

  // Call Soulz API to generate the agent
  try {
    const generateUrl = `${soulzApiUrl.replace(/\/$/, "")}/api/openclaw/generate`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (soulzApiKey) headers["Authorization"] = `Bearer ${soulzApiKey}`;

    const generateBody: Record<string, unknown> = { category };
    if (specialism) generateBody.specialism = specialism;
    if (styleTheme) generateBody.style_theme = styleTheme;
    if (taskDescription) generateBody.task_description = taskDescription;

    logger?.info?.(`[openclaw-subagents] Spawning agent: ${category}/${specialism || "any"}/${styleTheme || "random"}`);

    const apiRes = await fetch(generateUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(generateBody),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      logger?.warn?.(`[openclaw-subagents] Soulz API error ${apiRes.status}: ${errText}`);
      res.statusCode = apiRes.status;
      res.end(JSON.stringify({ error: `Soulz API error: ${errText}` }));
      return true;
    }

    const result = await apiRes.json() as Record<string, unknown>;

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      success: true,
      agent: result.agent,
      tracking_token: result.tracking_token,
      download_url: result.download_url,
    }));
  } catch (err) {
    logger?.warn?.(`[openclaw-subagents] Spawn error: ${err}`);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: `Failed to spawn agent: ${String(err)}` }));
  }
  return true;
}

function serveFile(
  filePath: string,
  ext: string,
  res: ServerResponse,
): boolean {
  try {
    const content = fs.readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader(
      "Content-Type",
      MIME[ext] || "application/octet-stream",
    );
    res.end(content);
    return true;
  } catch {
    res.statusCode = 404;
    res.end("Not found");
    return true;
  }
}
