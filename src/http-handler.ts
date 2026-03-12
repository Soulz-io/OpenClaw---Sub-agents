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

/**
 * Gateway only supports exact-path matching.
 * This handler serves on the EXACT path `/plugins/openclaw-subagents`:
 *   - No _api param → self-contained HTML bundle (inline JS+CSS)
 *   - ?_api=subagents → JSON list
 *   - ?_api=summary → JSON summary
 *   - ?_api=spawn (POST) → spawn agent
 */
export function createHttpHandler(params: HttpHandlerParams) {
  const { logger, uiRoot, soulzApiUrl, soulzApiKey, runtime } = params;

  let bundledHtml: string | null = null;
  let lastBundleTime = 0;

  function buildBundle(): string {
    const cssPath = path.join(uiRoot, "app.css");
    const jsPath = path.join(uiRoot, "app.js");

    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";
    let js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, "utf8") : "";

    // Rewrite API_BASE to use query-parameter dispatch
    js = js.replace(
      /const API_BASE\s*=\s*["'][^"']*["']/,
      `const API_BASE = "${PREFIX}"`,
    );

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Subagents Dashboard</title>
  <style>${css}</style>
</head>
<body>
  <div id="app"></div>
  <script type="module">${js}</script>
</body>
</html>`;
  }

  return async function handler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname !== PREFIX) return false;

    // ── API dispatch via _api query param ────────────────────
    const apiAction = url.searchParams.get("_api");

    if (apiAction === "subagents" && req.method === "GET") {
      return handleListSubagents(res, logger);
    }
    if (apiAction === "summary" && req.method === "GET") {
      return handleSummary(res, logger);
    }
    if (apiAction === "spawn" && req.method === "POST") {
      return handleSpawn(req, res, { soulzApiUrl, soulzApiKey, runtime, logger });
    }

    // ── HTML bundle ──────────────────────────────────────────
    const now = Date.now();
    if (!bundledHtml || now - lastBundleTime > 5000) {
      try {
        bundledHtml = buildBundle();
        lastBundleTime = now;
      } catch (err) {
        logger?.warn?.(`[openclaw-subagents] Bundle error: ${err}`);
        res.statusCode = 500;
        res.end("Failed to build UI bundle");
        return true;
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(bundledHtml);
    return true;
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
