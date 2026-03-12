const API_BASE = "/plugins/openclaw-subagents";
const POLL_INTERVAL = 5000;

let subagents = [];
let selectedRunId = null;
let pollTimer = null;

/* ── Spawn Modal Data ───────────────────────────────────────── */

const CATEGORIES = {
  design: { label: "Design", icon: "\u{1F3A8}", specialisms: ["User Research","Wireframing","Prototyping","Visual Design","Interaction Design","Design Systems","Accessibility","Mobile Design","Web Design","Brand Identity","Typography","Color Theory","Motion Design","Illustration","Usability Testing"] },
  software_engineering: { label: "Software Engineering", icon: "\u{1F4BB}", specialisms: ["React","Vue.js","Angular","Node.js","Python","Go","Rust","Java","Kotlin","Swift","TypeScript","GraphQL","REST APIs","Microservices","Kubernetes","Docker","AWS","GCP","Azure","PostgreSQL","MongoDB","Redis","Kafka","CI/CD","System Design","Performance Optimization","Security","Testing","Agile"] },
  product: { label: "Product", icon: "\u{1F4E6}", specialisms: ["Roadmapping","User Research","A/B Testing","Analytics","Prioritization","Stakeholder Management","Agile/Scrum","Go-to-Market","Competitive Analysis","Pricing Strategy","Feature Discovery","OKRs","Product-Led Growth"] },
  marketing: { label: "Marketing", icon: "\u{1F4E2}", specialisms: ["Content Strategy","SEO","SEM","Social Media","Email Marketing","Analytics","Brand Strategy","Copywriting","Conversion Optimization","Marketing Automation","Influencer Marketing","Community Building","Event Marketing","PR"] },
  sales: { label: "Sales", icon: "\u{1F4B0}", specialisms: ["Solution Design","Technical Discovery","Demo Architecture","Commercial Scoping","ROI Modeling","CRM Automation","Revenue Systems","Pipeline Design","GTM Systems","Solution Selling","Technical Validation"] },
  data: { label: "Data", icon: "\u{1F4CA}", specialisms: ["SQL","Python","R","Machine Learning","Statistics","Data Modeling","ETL/ELT","Data Warehousing","Visualization","A/B Testing","Experimentation","Big Data","Spark","Airflow","dbt","Snowflake","Databricks"] },
  customer_support: { label: "Customer Support", icon: "\u{1F91D}", specialisms: ["Incident Triage","Escalation Design","Knowledge Base Design","Support Automation","Onboarding Systems","Troubleshooting","Technical Writing","Root Cause Analysis","Service Quality Metrics","Support Process Design"] },
  finance: { label: "Finance", icon: "\u{1F4B5}", specialisms: ["Financial Modeling","Budgeting","Forecasting","GAAP","IFRS","Tax Planning","Cash Flow Management","Audit","Compliance","M&A","Investor Relations","Reporting"] },
  legal: { label: "Legal", icon: "\u2696\uFE0F", specialisms: ["Contract Review","IP Protection","Employment Law","Privacy/GDPR","Corporate Governance","M&A","Litigation","Regulatory Compliance","Risk Assessment","Licensing"] },
  hr: { label: "HR", icon: "\u{1F465}", specialisms: ["Capability Enablement","Training Systems","Evaluation Rubrics","Operational Readiness","Change Management","Quality Coaching","Policy Training","Enablement Metrics"] },
  it_ops: { label: "IT Ops", icon: "\u{1F527}", specialisms: ["Network Administration","System Administration","Cloud Infrastructure","Security","Troubleshooting","Automation","Monitoring","Backup/Recovery","Virtualization"] },
  security: { label: "Security", icon: "\u{1F510}", specialisms: ["Penetration Testing","Vulnerability Assessment","Incident Response","Security Architecture","Compliance","Risk Management","Cloud Security","Application Security","Cryptography"] },
  operations: { label: "Operations", icon: "\u2699\uFE0F", specialisms: ["Process Improvement","Project Management","Data Analysis","Automation","Strategic Planning","OKRs","Vendor Management","Agent Orchestration","Multi-agent Workflows","Quality Control"] },
  generalist: { label: "Generalist", icon: "\u{1F310}", specialisms: ["Knowledge Architecture","Research Synthesis","Documentation Design","Prompt Libraries","Retrieval Design","Source Curation","Decision Documentation","Memory Systems"] },
};

const STYLES = [
  { id: "modern_agency", label: "Modern Agency", desc: "Clean, polished, trend-aware", icon: "\u2728" },
  { id: "indie_craft", label: "Indie Craft", desc: "Thoughtful, unique, quality-focused", icon: "\u{1F3B5}" },
  { id: "enterprise", label: "Enterprise", desc: "Reliable, documented, scalable", icon: "\u{1F3E2}" },
  { id: "startup", label: "Startup", desc: "Fast, pragmatic, ship-first", icon: "\u{1F680}" },
  { id: "human_centered", label: "Human-Centered", desc: "Empathetic, user-focused", icon: "\u2764\uFE0F" },
  { id: "data_driven", label: "Data-Driven", desc: "Metrics-focused, evidence-based", icon: "\u{1F4C8}" },
];

let spawnModal = { open: false, step: 1, category: null, specialism: null, style: null, loading: false, result: null, error: null };

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
    const res = await fetch(`${API_BASE}?_api=subagents`);
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

  let html = `<div class="header-row"><h1>Subagents</h1><button class="spawn-btn" data-open-spawn>+ Spawn Agent</button></div>`;

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

  // Spawn modal
  if (spawnModal.open) {
    html += renderSpawnModal();
  }

  app.innerHTML = html;
  bindEvents();
  bindSpawnEvents();
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

/* ── Spawn Modal ────────────────────────────────────────────── */

function renderSpawnModal() {
  const m = spawnModal;
  const catData = m.category ? CATEGORIES[m.category] : null;

  let breadcrumb = "";
  if (m.category) {
    breadcrumb += `<span class="crumb" data-spawn-to="1">${esc(catData.label)}</span>`;
    if (m.specialism) {
      breadcrumb += ` <span class="crumb-sep">&rsaquo;</span> <span class="crumb" data-spawn-to="2">${esc(m.specialism)}</span>`;
      if (m.style) {
        const st = STYLES.find(s => s.id === m.style);
        breadcrumb += ` <span class="crumb-sep">&rsaquo;</span> <span class="crumb">${esc(st ? st.label : m.style)}</span>`;
      }
    }
  }

  let body = "";

  // Result / error state
  if (m.result) {
    const a = m.result.agent || {};
    body = `<div class="spawn-success">
      <div class="spawn-success__icon">&#x2705;</div>
      <div class="spawn-success__title">Agent Spawned</div>
      <div class="spawn-success__name">${esc(a.name || "Unknown")}</div>
      <div class="spawn-success__role">${esc(a.role || "")}</div>
      <div class="spawn-success__bio">${esc(a.short_bio || "")}</div>
      <button class="spawn-btn spawn-btn--full" data-spawn-close>Close</button>
    </div>`;
  } else if (m.error) {
    body = `<div class="spawn-error">
      <div class="spawn-success__icon">&#x274C;</div>
      <div class="spawn-success__title">Failed to spawn</div>
      <div class="spawn-error__msg">${esc(m.error)}</div>
      <button class="spawn-btn spawn-btn--full" data-spawn-retry>Try Again</button>
    </div>`;
  } else if (m.loading) {
    body = `<div class="spawn-loading">
      <div class="spawn-loading__spinner"></div>
      <div class="spawn-loading__text">Generating agent...</div>
    </div>`;
  } else if (m.step === 1) {
    // Category selection
    body = `<div class="spawn-step-title">Choose a category</div>
    <div class="cat-grid">`;
    for (const [key, cat] of Object.entries(CATEGORIES)) {
      body += `<button class="cat-card" data-cat="${esc(key)}">
        <span class="cat-card__icon">${cat.icon}</span>
        <span class="cat-card__label">${esc(cat.label)}</span>
      </button>`;
    }
    body += `</div>`;
  } else if (m.step === 2) {
    // Specialism selection
    body = `<div class="spawn-step-title">Choose a specialism</div>
    <div class="spec-grid">`;
    for (const spec of catData.specialisms) {
      body += `<button class="spec-pill" data-spec="${esc(spec)}">${esc(spec)}</button>`;
    }
    body += `</div>`;
  } else if (m.step === 3) {
    // Style selection + task description
    body = `<div class="spawn-step-title">Choose a style</div>
    <div class="style-grid">`;
    for (const st of STYLES) {
      const sel = m.style === st.id ? " style-card--selected" : "";
      body += `<button class="style-card${sel}" data-style="${esc(st.id)}">
        <span class="style-card__icon">${st.icon}</span>
        <span class="style-card__label">${esc(st.label)}</span>
        <span class="style-card__desc">${esc(st.desc)}</span>
      </button>`;
    }
    body += `</div>
    <div class="spawn-task">
      <label class="spawn-task__label" for="task-desc">Task description <span style="color:var(--text-dim)">(optional)</span></label>
      <textarea id="task-desc" class="spawn-task__input" placeholder="Describe what this agent should work on..." rows="3"></textarea>
    </div>
    <button class="spawn-btn spawn-btn--full spawn-btn--go"${m.style ? "" : " disabled"} data-do-spawn>Spawn Agent</button>`;
  }

  return `<div class="spawn-overlay" data-spawn-overlay>
    <div class="spawn-panel">
      <div class="spawn-header">
        <h2>Spawn Agent</h2>
        <button class="close-btn" data-spawn-close>&times;</button>
      </div>
      ${breadcrumb ? `<div class="spawn-breadcrumb">${breadcrumb}</div>` : ""}
      ${body}
    </div>
  </div>`;
}

function bindSpawnEvents() {
  // Open spawn modal
  const openBtn = document.querySelector("[data-open-spawn]");
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      spawnModal = { open: true, step: 1, category: null, specialism: null, style: null, loading: false, result: null, error: null };
      render();
    });
  }

  // Close modal
  document.querySelectorAll("[data-spawn-close]").forEach(el => {
    el.addEventListener("click", () => {
      spawnModal.open = false;
      spawnModal.result = null;
      spawnModal.error = null;
      render();
    });
  });
  const overlay = document.querySelector("[data-spawn-overlay]");
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        spawnModal.open = false;
        render();
      }
    });
  }

  // Category cards
  document.querySelectorAll("[data-cat]").forEach(el => {
    el.addEventListener("click", () => {
      spawnModal.category = el.getAttribute("data-cat");
      spawnModal.step = 2;
      render();
    });
  });

  // Specialism pills
  document.querySelectorAll("[data-spec]").forEach(el => {
    el.addEventListener("click", () => {
      spawnModal.specialism = el.getAttribute("data-spec");
      spawnModal.step = 3;
      spawnModal.style = null;
      render();
    });
  });

  // Style cards
  document.querySelectorAll("[data-style]").forEach(el => {
    el.addEventListener("click", () => {
      spawnModal.style = el.getAttribute("data-style");
      render();
    });
  });

  // Breadcrumb navigation
  document.querySelectorAll("[data-spawn-to]").forEach(el => {
    el.addEventListener("click", () => {
      const step = parseInt(el.getAttribute("data-spawn-to"), 10);
      spawnModal.step = step;
      if (step <= 1) { spawnModal.category = null; spawnModal.specialism = null; spawnModal.style = null; }
      if (step <= 2) { spawnModal.specialism = null; spawnModal.style = null; }
      render();
    });
  });

  // Spawn button
  const spawnBtn = document.querySelector("[data-do-spawn]");
  if (spawnBtn) {
    spawnBtn.addEventListener("click", doSpawn);
  }

  // Retry button
  const retryBtn = document.querySelector("[data-spawn-retry]");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      spawnModal.error = null;
      spawnModal.loading = false;
      render();
    });
  }
}

async function doSpawn() {
  const m = spawnModal;
  if (!m.category || !m.style) return;

  m.loading = true;
  m.error = null;
  render();

  try {
    const body = { category: m.category, style_theme: m.style };
    if (m.specialism) body.specialism = m.specialism;
    const taskEl = document.getElementById("task-desc");
    if (taskEl && taskEl.value.trim()) body.task_description = taskEl.value.trim();

    const res = await fetch(`${API_BASE}?_api=spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    m.loading = false;
    m.result = data;
    render();

    // Refresh subagents list
    setTimeout(fetchSubagents, 1000);
  } catch (err) {
    m.loading = false;
    m.error = String(err.message || err);
    render();
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
