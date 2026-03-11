const API_BASE = "/plugins/openclaw-subagents/api";
const POLL_INTERVAL = 5000;

let subagents = [];
let selectedRunId = null;
let pollTimer = null;

/* ── Helpers ─────────────────────────────────────────────────── */

function ago(ms) {
  if (!ms) return "—";
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function duration(start, end) {
  if (!start) return "—";
  const ms = (end || Date.now()) - start;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function truncate(str, len = 80) {
  if (!str) return "—";
  return str.length > len ? str.slice(0, len) + "…" : str;
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

/* ── Fetch ───────────────────────────────────────────────────── */

async function fetchSubagents() {
  try {
    const res = await fetch(`${API_BASE}/subagents`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    subagents = await res.json();
  } catch (err) {
    console.warn("[subagents-dashboard] fetch error:", err);
  }
  render();
}

/* ── Render ──────────────────────────────────────────────────── */

function render() {
  const app = document.getElementById("app");
  if (!app) return;

  const running = subagents.filter((s) => s.status === "running");
  const done = subagents.filter((s) => s.status === "done");
  const errors = subagents.filter(
    (s) => s.status === "error" || s.status === "timeout",
  );

  let html = `<h1>Subagents</h1>`;

  // Summary cards
  html += `<div class="summary">
    <div class="card"><div class="card__value">${subagents.length}</div><div class="card__label">Total</div></div>
    <div class="card card--running"><div class="card__value">${running.length}</div><div class="card__label">Running</div></div>
    <div class="card card--done"><div class="card__value">${done.length}</div><div class="card__label">Completed</div></div>
    <div class="card card--error"><div class="card__value">${errors.length}</div><div class="card__label">Errors</div></div>
  </div>`;

  if (subagents.length === 0) {
    html += `<div class="empty">
      <div class="empty__icon">&#x1F916;</div>
      <div class="empty__text">No subagents yet</div>
      <div class="empty__hint">Subagents will appear here when spawned by the main agent.</div>
    </div>`;
  } else {
    html += `<div class="table-wrap"><table>
      <thead><tr>
        <th>Status</th>
        <th>Label</th>
        <th>Prompt</th>
        <th>Model</th>
        <th>Duration</th>
        <th>Last Active</th>
      </tr></thead><tbody>`;

    for (const s of subagents) {
      const lastActive = s.endedAt || s.startedAt || s.createdAt;
      html += `<tr data-run="${esc(s.runId)}">
        <td><span class="badge badge--${s.status}">${s.status}</span></td>
        <td>${esc(s.label) || "<em style='color:var(--text-dim)'>unnamed</em>"}</td>
        <td><span class="task-preview">${esc(truncate(s.task, 80))}</span></td>
        <td style="font-size:0.78rem;color:var(--text-dim)">${esc(s.model) || "—"}</td>
        <td class="token-cell">${duration(s.startedAt, s.endedAt)}</td>
        <td style="color:var(--text-dim)">${ago(lastActive)}</td>
      </tr>`;
    }

    html += `</tbody></table></div>`;
  }

  // Detail panel
  if (selectedRunId) {
    const s = subagents.find((x) => x.runId === selectedRunId);
    if (s) {
      html += renderDetail(s);
    }
  }

  app.innerHTML = html;
  bindEvents();
}

function renderDetail(s) {
  const lastActive = s.endedAt || s.startedAt || s.createdAt;
  return `<div class="detail-overlay" data-overlay>
    <div class="detail-panel">
      <button class="close-btn" data-close>&times;</button>
      <h2>${esc(s.label) || "Subagent"} <span class="badge badge--${s.status}">${s.status}</span></h2>

      <div class="detail-section">
        <div class="detail-section__title">Prompt</div>
        <div class="task-full">${esc(s.task) || "—"}</div>
      </div>

      <div class="meta-grid">
        <div class="detail-section">
          <div class="detail-section__title">Run ID</div>
          <div class="detail-section__value" style="font-family:var(--mono);font-size:0.78rem;word-break:break-all">${esc(s.runId)}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__title">Session Key</div>
          <div class="detail-section__value" style="font-family:var(--mono);font-size:0.78rem;word-break:break-all">${esc(s.childSessionKey)}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__title">Model</div>
          <div class="detail-section__value">${esc(s.model) || "—"}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__title">Mode</div>
          <div class="detail-section__value">${esc(s.spawnMode) || "run"}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__title">Created</div>
          <div class="detail-section__value">${s.createdAt ? new Date(s.createdAt).toLocaleString() : "—"}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__title">Started</div>
          <div class="detail-section__value">${s.startedAt ? new Date(s.startedAt).toLocaleString() : "—"}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__title">Ended</div>
          <div class="detail-section__value">${s.endedAt ? new Date(s.endedAt).toLocaleString() : "—"}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__title">Duration</div>
          <div class="detail-section__value">${duration(s.startedAt, s.endedAt)}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__title">Last Activity</div>
          <div class="detail-section__value">${ago(lastActive)}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section__title">Parent Session</div>
          <div class="detail-section__value" style="font-family:var(--mono);font-size:0.78rem;word-break:break-all">${esc(s.requesterSessionKey) || "—"}</div>
        </div>
      </div>

      ${s.error ? `<div class="detail-section">
        <div class="detail-section__title">Error</div>
        <div class="task-full" style="color:var(--red)">${esc(s.error)}</div>
      </div>` : ""}

      ${s.outcome ? `<div class="detail-section">
        <div class="detail-section__title">Outcome</div>
        <div class="detail-section__value">${esc(JSON.stringify(s.outcome))}</div>
      </div>` : ""}
    </div>
  </div>`;
}

function bindEvents() {
  // Row clicks → open detail
  document.querySelectorAll("tr[data-run]").forEach((row) => {
    row.addEventListener("click", () => {
      selectedRunId = row.getAttribute("data-run");
      render();
    });
  });

  // Close detail
  const overlay = document.querySelector("[data-overlay]");
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.hasAttribute("data-close")) {
        selectedRunId = null;
        render();
      }
    });
  }
}

/* ── Init ────────────────────────────────────────────────────── */

// Theme sync from parent iframe
function syncTheme() {
  try {
    const parent = window.parent;
    if (parent === window) return;
    const app = parent.document.querySelector("openclaw-app");
    if (!app) return;
    const root = app.shadowRoot || app;
    const style = window.parent.getComputedStyle(root);
    const vars = ["--bg", "--bg-card", "--text", "--accent", "--border"];
    for (const v of vars) {
      const val = style.getPropertyValue(v);
      if (val) document.documentElement.style.setProperty(v, val);
    }
  } catch {
    /* cross-origin or unavailable */
  }
}

syncTheme();
fetchSubagents();

// Poll while visible
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(fetchSubagents, POLL_INTERVAL);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling();
  else { fetchSubagents(); startPolling(); }
});

startPolling();
