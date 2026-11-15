import { safeFailureCategory } from "../hosting/diagnostics.mjs";

const PHASES = new Set(["child_process", "workload", "database_preflight", "create_fixtures", "local_cutover",
  "auth_finalize", "readiness", "tenant_isolation", "enable_writes", "draft_start", "stage_attestation",
  "authenticated_reads", "mutation_cycle", "draft_race", "draft_replay", "draft_privacy", "draft_undo",
  "trade_create", "trade_accept", "trade_replay", "ownership_assertions", "stage_thresholds",
  "final_assertions", "disable_writes", "fixture_cleanup", "lease_cleanup", "database_cleanup"]);
const CATEGORIES = new Set(["CHILD_FAILED", "CHILD_TERMINATED", "INVALID_JSON", "REQUEST_TIMEOUT", "REQUEST_FAILED",
  "LOAD_ABORTED", "DEADLINE_EXCEEDED", "OPERATOR_STOP", "BUDGET_EXCEEDED", "LATENCY_LIMIT", "INSUFFICIENT_SAMPLES", "ASSERTION_FAILED"]);
const COUNTERS = { stage: 3, cyclesCompleted: 10, requestCount: 6000, failedRequests: 6000 };
const FIXED_MESSAGES = new Map([
  ["Malformed JSON response from rehearsal target", "INVALID_JSON"],
  ["Rehearsal deadline exceeded", "DEADLINE_EXCEEDED"],
  ["Load stopped by operator kill switch", "OPERATOR_STOP"],
  ["Load stopped by process signal", "OPERATOR_STOP"],
  ["Load request budget exhausted", "BUDGET_EXCEEDED"],
  ["Response exceeds rehearsal bound", "BUDGET_EXCEEDED"],
  ["Aggregate response budget exhausted", "BUDGET_EXCEEDED"],
  ["read p95 threshold exceeded", "LATENCY_LIMIT"],
  ["command p95 threshold exceeded", "LATENCY_LIMIT"],
  ["Insufficient authenticated read samples", "INSUFFICIENT_SAMPLES"],
]);
function category(error) {
  const fixed = FIXED_MESSAGES.get(error?.message);
  if (fixed) return fixed;
  const status = /^Unexpected HTTP status ([45][0-9]{2}) for \/api\/[^\s]+$/.exec(error?.message ?? "")?.[1];
  if (status) return `TARGET_HTTP_${status}`;
  if (error?.name === "TimeoutError") return "REQUEST_TIMEOUT";
  if (error?.name === "AbortError") return "LOAD_ABORTED";
  if (error?.message === "fetch failed") return "REQUEST_FAILED";
  const provider = safeFailureCategory(error);
  if (provider !== "GUARD_OR_OPERATION_FAILED") return provider;
  return error?.code === "ERR_ASSERTION" ? "ASSERTION_FAILED" : provider;
}
class LoadFailure extends Error {
  constructor(error, phase) {
    super("Bounded load failed; details redacted");
    this.phase = PHASES.has(phase) ? phase : "workload";
    this.category = category(error);
  }
}
/** Preserve the first failing branch when peers abort or outer phases unwind. */
export function markLoadFailure(error, phase, signal) {
  // timers/promises and body reads can replace an abort reason with AbortError.
  const first = signal?.aborted ? signal.reason : error;
  return first instanceof LoadFailure ? first : new LoadFailure(first, phase);
}
function validCategory(value) {
  return typeof value === "string" && (CATEGORIES.has(value) || /^TARGET_HTTP_[45][0-9]{2}$/.test(value) ||
    safeFailureCategory({ category: value }) === value);
}
function validateRecord(row) {
  const keys = ["event", "phase", "category", ...Object.keys(COUNTERS)];
  if (!row || row.event !== "load_failure" || !PHASES.has(row.phase) || !validCategory(row.category) ||
    Object.keys(row).some(key => !keys.includes(key))) return null;
  const result = { event: "load_failure", phase: row.phase, category: row.category };
  for (const [key, maximum] of Object.entries(COUNTERS)) {
    if (!Object.hasOwn(row, key)) continue;
    if (!Number.isInteger(row[key]) || row[key] < 0 || row[key] > maximum) return null;
    result[key] = row[key];
  }
  if (result.failedRequests !== undefined && (result.requestCount === undefined || result.failedRequests > result.requestCount)) return null;
  return result;
}
export function loadFailureRecord(error, phase, counters = {}) {
  const failure = markLoadFailure(error, phase);
  return validateRecord({ event: "load_failure", phase: failure.phase, category: failure.category, ...counters }) ??
    { event: "load_failure", phase: failure.phase, category: failure.category };
}
/** Parse only the last bounded stdout line; never forward the child object/raw text. */
export function hostedChildFailure(output, killed = false) {
  if (typeof output === "string" && Buffer.byteLength(output) <= 262144) {
    try {
      const record = validateRecord(JSON.parse(output.trim().split(/\r?\n/).at(-1)));
      if (record) return record;
    } catch { /* Provider/child text must never become an exception diagnostic. */ }
  }
  return { event: "load_failure", phase: "child_process", category: killed ? "CHILD_TERMINATED" : "CHILD_FAILED" };
}
