import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const INJECTOR_SCRIPT_TAG =
  '<script src="/plugins/openclaw-subagents/injector.js" defer></script>';

interface ControlUiInjectorParams {
  api: OpenClawPluginApi;
}

/**
 * Registers an HTTP handler that intercepts requests for the Control UI
 * index.html and injects the Subagents tab injector script.
 *
 * This runs BEFORE the gateway's built-in Control UI handler in the
 * dispatch chain, so we can serve a modified index.html without copying
 * any files or changing any config.
 */
export function registerControlUiInjector(params: ControlUiInjectorParams): void {
  const { api } = params;
  const logger = api.logger;

  // ── Resolve the Control UI root directory ───────────────────
  const controlUiRoot = resolveControlUiRoot(api);
  if (!controlUiRoot) {
    logger.warn(
      "[openclaw-subagents] Could not locate control-ui index.html; " +
        "tab injection skipped.",
    );
    return;
  }

  const indexHtmlPath = path.join(controlUiRoot, "index.html");
  logger.info(
    `[openclaw-subagents] Tab injection via HTTP handler (control-ui: ${controlUiRoot})`,
  );

  // ── Read basePath + assistant config ─────────────────────────
  const cfg = api.config as Record<string, any>;
  const basePath = normalizeBasePath(cfg?.gateway?.controlUi?.basePath);
  const assistantName =
    cfg?.assistants?.[0]?.name ?? cfg?.name ?? "OpenClaw";
  const assistantAvatar = cfg?.assistants?.[0]?.avatar ?? "";

  // ── Cache: read + patch index.html once, invalidate on mtime ─
  let cachedHtml: string | null = null;
  let cachedMtime = 0;

  function getInjectedHtml(): string {
    const stat = fs.statSync(indexHtmlPath);
    if (cachedHtml && stat.mtimeMs === cachedMtime) return cachedHtml;

    let html = fs.readFileSync(indexHtmlPath, "utf8");

    // 1. Replicate gateway's own config injection (basePath, assistant name/avatar)
    html = injectControlUiConfig(html, { basePath, assistantName, assistantAvatar });

    // 2. Inject our injector script tag before </body>
    if (!html.includes("openclaw-subagents/injector.js")) {
      html = html.replace("</body>", `    ${INJECTOR_SCRIPT_TAG}\n  </body>`);
    }

    cachedHtml = html;
    cachedMtime = stat.mtimeMs;
    return html;
  }

  // ── Register the handler ────────────────────────────────────
  api.registerHttpHandler(
    async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
      if (req.method !== "GET" && req.method !== "HEAD") return false;

      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`,
      );

      if (!isControlUiHtmlRequest(url.pathname, basePath, controlUiRoot)) {
        return false;
      }

      try {
        const html = getInjectedHtml();
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        res.end(html);
        return true;
      } catch (err) {
        logger.warn(`[openclaw-subagents] Failed to serve injected HTML: ${err}`);
        return false; // Fall through to built-in handler
      }
    },
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

/**
 * Determines whether a request path should receive the injected index.html.
 * Only intercepts paths that would normally result in index.html being
 * served; all static assets (.js, .css, .png, etc.) pass through.
 */
function isControlUiHtmlRequest(
  pathname: string,
  basePath: string,
  controlUiRoot: string,
): boolean {
  // With basePath (e.g., "/openclaw"):
  //   /openclaw  → redirect (let gateway handle)
  //   /openclaw/ → index.html ✓
  //   /openclaw/assets/... → static file, skip
  //   /openclaw/sessions/abc → SPA route, index.html ✓
  if (basePath) {
    if (pathname === basePath) return false; // redirect case
    if (!pathname.startsWith(`${basePath}/`)) return false;
  }

  // Strip basePath to get the UI-relative path
  const uiPath = basePath && pathname.startsWith(`${basePath}/`)
    ? pathname.slice(basePath.length)
    : pathname;

  // If the path has a file extension, only intercept .html (and specifically index.html)
  const ext = path.extname(uiPath);
  if (ext) {
    if (ext !== ".html") return false;
    const rel = uiPath.slice(1);
    const filePath = path.join(controlUiRoot, rel);
    return path.basename(filePath) === "index.html";
  }

  // No extension — either "/" or an SPA route
  // Check if the path maps to a real file on disk (e.g., a directory listing)
  const rel = uiPath.slice(1) || "";
  if (rel) {
    const filePath = path.join(controlUiRoot, rel);
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return false; // Real file, not index.html
      }
    } catch {
      /* not a file — this is an SPA route → serve index.html */
    }
  }

  // This would be served as index.html (root or SPA fallback)
  return true;
}

/**
 * Finds the original Control UI directory. Tries multiple strategies:
 * 1. api.config gateway.controlUi.root (unless it's our old patched dir)
 * 2. require.resolve to find the openclaw package
 * 3. Known candidate directories
 */
function resolveControlUiRoot(api: OpenClawPluginApi): string | null {
  const cfg = api.config as Record<string, any>;
  const configRoot: string | undefined = cfg?.gateway?.controlUi?.root;

  // Strategy 1: Config root (skip if pointing at our old patched directory)
  if (typeof configRoot === "string" && configRoot.trim()) {
    const resolved = path.resolve(configRoot.trim());
    if (!resolved.includes("control-ui-patched")) {
      const indexPath = path.join(resolved, "index.html");
      if (fs.existsSync(indexPath)) return resolved;
    }
  }

  // Strategy 2: Use require.resolve to find openclaw
  try {
    const require_ = createRequire(import.meta.url);
    const openclawMain = require_.resolve("openclaw");
    const openclawDir = path.dirname(openclawMain);
    const candidates = [
      path.join(openclawDir, "control-ui"),
      path.join(openclawDir, "../control-ui"),
      path.join(openclawDir, "dist/control-ui"),
      path.join(openclawDir, "../dist/control-ui"),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, "index.html"))) return dir;
    }
  } catch {
    /* require.resolve not available or failed */
  }

  // Strategy 3: Known candidate directories
  const candidates: string[] = [
    "/usr/lib/node_modules/openclaw/dist/control-ui",
  ];

  // nvm global
  if (process.env.NVM_BIN) {
    candidates.push(
      path.resolve(
        process.env.NVM_BIN,
        "../lib/node_modules/openclaw/dist/control-ui",
      ),
    );
  }

  // cwd workspace
  candidates.push(
    path.resolve(process.cwd(), "node_modules/openclaw/dist/control-ui"),
  );

  // Home-based nvm (fallback)
  const home = process.env.HOME || "/root";
  try {
    const nvmDir = path.join(home, ".nvm/versions/node");
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir);
      for (const v of versions) {
        candidates.push(
          path.join(nvmDir, v, "lib/node_modules/openclaw/dist/control-ui"),
        );
      }
    }
  } catch {
    /* nvm not available */
  }

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "index.html"))) return dir;
    } catch {
      /* skip */
    }
  }

  return null;
}

/**
 * Replicates the gateway's injectControlUiConfig behavior.
 * Injects __OPENCLAW_CONTROL_UI_BASE_PATH__, __OPENCLAW_ASSISTANT_NAME__,
 * and __OPENCLAW_ASSISTANT_AVATAR__ into the HTML.
 */
function injectControlUiConfig(
  html: string,
  opts: { basePath: string; assistantName: string; assistantAvatar: string },
): string {
  // Gateway skips injection if already present
  if (html.includes("__OPENCLAW_ASSISTANT_NAME__")) return html;

  const script =
    `<script>` +
    `window.__OPENCLAW_CONTROL_UI_BASE_PATH__=${JSON.stringify(opts.basePath)};` +
    `window.__OPENCLAW_ASSISTANT_NAME__=${JSON.stringify(opts.assistantName)};` +
    `window.__OPENCLAW_ASSISTANT_AVATAR__=${JSON.stringify(opts.assistantAvatar)};` +
    `</script>`;

  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    return `${html.slice(0, headClose)}    ${script}\n  ${html.slice(headClose)}`;
  }
  return `${script}${html}`;
}

function normalizeBasePath(basePath?: string): string {
  if (!basePath) return "";
  let normalized = basePath.trim();
  if (!normalized) return "";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (normalized === "/") return "";
  if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}
