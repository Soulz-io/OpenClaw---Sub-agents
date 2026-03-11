import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Lightweight in-process store that reads subagent run records from the
 * gateway's persisted `runs.json` AND collects live events via plugin hooks.
 *
 * This avoids importing internal bundled modules (which use hashed filenames).
 */

export interface SubagentRecord {
  runId: string;
  childSessionKey: string;
  requesterSessionKey?: string;
  requesterDisplayKey?: string;
  task: string;
  label: string;
  model: string;
  spawnMode: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  status: string;
  outcome?: string;
  error?: string;
}

// In-memory records captured via hooks (supplements on-disk data)
const hookRecords = new Map<string, Partial<SubagentRecord>>();

/**
 * Called from plugin hooks to record a spawned subagent.
 */
export function recordSpawned(event: {
  runId: string;
  childSessionKey: string;
  agentId?: string;
  label?: string;
  mode?: string;
}): void {
  hookRecords.set(event.runId, {
    runId: event.runId,
    childSessionKey: event.childSessionKey,
    label: event.label || event.agentId || "",
    spawnMode: event.mode || "run",
    createdAt: Date.now(),
    startedAt: Date.now(),
    status: "running",
  });
}

/**
 * Called from plugin hooks to record a finished subagent.
 */
export function recordEnded(event: {
  runId?: string;
  targetSessionKey?: string;
  outcome?: string;
  error?: string;
  endedAt?: number;
}): void {
  // Try to find by runId first, then by sessionKey
  let key = event.runId;
  if (!key && event.targetSessionKey) {
    for (const [k, v] of hookRecords) {
      if (v.childSessionKey === event.targetSessionKey) {
        key = k;
        break;
      }
    }
  }
  if (!key) return;

  const existing = hookRecords.get(key) || {};
  hookRecords.set(key, {
    ...existing,
    endedAt: event.endedAt || Date.now(),
    status: event.outcome === "error" || event.outcome === "timeout"
      ? event.outcome
      : "done",
    outcome: event.outcome,
    error: event.error,
  });
}

/**
 * Returns all known subagent records (disk + hooks).
 */
export function getAllRecords(): SubagentRecord[] {
  const byRunId = new Map<string, SubagentRecord>();

  // 1. Read persisted runs.json
  const diskRecords = readRunsFromDisk();
  for (const rec of diskRecords) {
    byRunId.set(rec.runId, rec);
  }

  // 2. Merge hook records (they take priority for status)
  for (const [runId, hook] of hookRecords) {
    const existing = byRunId.get(runId);
    if (existing) {
      // Update status from hooks if more recent
      if (hook.endedAt && !existing.endedAt) {
        existing.endedAt = hook.endedAt;
        existing.status = hook.status || existing.status;
        existing.outcome = hook.outcome || existing.outcome;
        existing.error = hook.error || existing.error;
      }
    } else {
      byRunId.set(runId, {
        runId,
        childSessionKey: hook.childSessionKey || "",
        requesterSessionKey: hook.requesterSessionKey,
        task: hook.task || "",
        label: hook.label || "",
        model: hook.model || "",
        spawnMode: hook.spawnMode || "run",
        createdAt: hook.createdAt || Date.now(),
        startedAt: hook.startedAt,
        endedAt: hook.endedAt,
        status: hook.status || "unknown",
        outcome: hook.outcome,
        error: hook.error,
      });
    }
  }

  // Sort: running first, then by most recent
  const records = Array.from(byRunId.values());
  records.sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (b.status === "running" && a.status !== "running") return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return records;
}

/**
 * Returns summary statistics.
 */
export function getSummary(): {
  total: number;
  running: number;
  done: number;
  error: number;
} {
  const records = getAllRecords();
  return {
    total: records.length,
    running: records.filter((r) => r.status === "running").length,
    done: records.filter((r) => r.status === "done").length,
    error: records.filter(
      (r) => r.status === "error" || r.status === "timeout",
    ).length,
  };
}

// ── Disk reader ──────────────────────────────────────────────

function readRunsFromDisk(): SubagentRecord[] {
  const filePath = resolveRunsJsonPath();
  if (!filePath) return [];

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);

    if (!data || typeof data !== "object") return [];

    const runsObj = data.runs || {};
    const records: SubagentRecord[] = [];

    for (const [runId, run] of Object.entries(runsObj)) {
      const r = run as any;
      records.push({
        runId,
        childSessionKey: r.childSessionKey || "",
        requesterSessionKey: r.requesterSessionKey || "",
        requesterDisplayKey: r.requesterDisplayKey || "",
        task: r.task || "",
        label: r.label || "",
        model: r.model || "",
        spawnMode: r.spawnMode || "run",
        createdAt: r.createdAt || 0,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        status: inferStatus(r),
        outcome: r.outcome?.status || r.outcome,
        error: r.outcome?.error || r.error,
      });
    }

    return records;
  } catch {
    return [];
  }
}

function inferStatus(run: any): string {
  if (run.endedAt) {
    const outcome = run.outcome?.status ?? run.outcome;
    if (outcome === "error") return "error";
    if (outcome === "timeout") return "timeout";
    return "done";
  }
  if (run.startedAt) return "running";
  return "pending";
}

function resolveRunsJsonPath(): string | null {
  // Try common locations for the subagent registry
  const candidates = [
    // Under the openclaw home dir
    path.join(os.homedir(), ".openclaw", "subagents", "runs.json"),
    // Root-level openclaw dir (daemon)
    "/home/.openclaw/subagents/runs.json",
    // XDG state
    path.join(
      process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
      "openclaw",
      "subagents",
      "runs.json",
    ),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* skip */
    }
  }

  return null;
}
