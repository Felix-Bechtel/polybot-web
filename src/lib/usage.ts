// Claude token usage tracker.
//
// Honest scope:
//  - The Anthropic API does NOT expose a "remaining quota" value for API-key
//    usage — billing is per-token and the balance lives in the Anthropic
//    console, not the API. So we can only track what we've SPENT.
//  - The "5-hour window" below is a client-side rolling window that matches
//    the cadence of Claude.ai subscription resets. It's used to show
//    "spent in the last 5h" and the time until the next rolling cutoff.

export interface UsageRecord {
  at: number;                      // epoch ms
  kind: "chat" | "alert-enrich";
  input: number;                   // input tokens
  output: number;                  // output tokens
  cacheRead?: number;              // prompt-cache hits
  cacheWrite?: number;             // prompt-cache writes
  model?: string;
}

export interface UsageWindow {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  total: number;                   // input + output (cache writes charged separately in API, but shown)
  calls: number;
  byKind: Record<string, { calls: number; input: number; output: number }>;
  windowMs: number;                // 18_000_000 for 5h
  resetsAtMs: number;              // epoch ms of next reset (oldest-record + windowMs)
}

const STORAGE_KEY = "polybot.usage.v1";
export const WINDOW_MS = 5 * 60 * 60 * 1000;           // 5 hours
const MAX_RECORDS = 2000;                              // cap history

// In-memory fallback when localStorage isn't available (tests, older
// embedded webviews). Keeps the API consistent without crashes.
let memStore: string | null = null;

function ls(): Storage | null {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      return localStorage;
    }
  } catch { /* cross-origin access may throw */ }
  return null;
}

type Listener = (u: UsageWindow) => void;
const listeners = new Set<Listener>();
export function onUsageChange(fn: Listener): () => void {
  listeners.add(fn); return () => listeners.delete(fn);
}

function loadAll(): UsageRecord[] {
  try {
    const raw = ls()?.getItem(STORAGE_KEY) ?? memStore;
    return raw ? (JSON.parse(raw) as UsageRecord[]) : [];
  } catch { return []; }
}
function saveAll(r: UsageRecord[]): void {
  const serialized = JSON.stringify(r.slice(-MAX_RECORDS));
  const store = ls();
  if (store) { try { store.setItem(STORAGE_KEY, serialized); } catch { memStore = serialized; } }
  else { memStore = serialized; }
  const w = windowSummary();
  listeners.forEach((l) => l(w));
}

export function recordUsage(r: Omit<UsageRecord, "at"> & { at?: number }): void {
  const rec: UsageRecord = {
    at: r.at ?? Date.now(),
    kind: r.kind,
    input: r.input | 0,
    output: r.output | 0,
    cacheRead: r.cacheRead,
    cacheWrite: r.cacheWrite,
    model: r.model,
  };
  const all = loadAll();
  all.push(rec);
  saveAll(all);
}

export function windowSummary(now = Date.now()): UsageWindow {
  const all = loadAll();
  const cutoff = now - WINDOW_MS;
  const recent = all.filter((r) => r.at >= cutoff);
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
  const byKind: UsageWindow["byKind"] = {};
  for (const r of recent) {
    totalInput += r.input;
    totalOutput += r.output;
    totalCacheRead += r.cacheRead ?? 0;
    totalCacheWrite += r.cacheWrite ?? 0;
    const k = byKind[r.kind] ?? { calls: 0, input: 0, output: 0 };
    k.calls += 1; k.input += r.input; k.output += r.output;
    byKind[r.kind] = k;
  }
  // Reset time = when the oldest in-window record ages out.
  const resetsAtMs = recent.length > 0 ? recent[0].at + WINDOW_MS : now + WINDOW_MS;
  return {
    totalInput, totalOutput, totalCacheRead, totalCacheWrite,
    total: totalInput + totalOutput,
    calls: recent.length,
    byKind, windowMs: WINDOW_MS, resetsAtMs,
  };
}

export function cumulativeTotals(): { input: number; output: number; calls: number } {
  const all = loadAll();
  let input = 0, output = 0;
  for (const r of all) { input += r.input; output += r.output; }
  return { input, output, calls: all.length };
}

/** Average tokens per "alert-enrich" call — used to preview cost of an alert. */
export function avgPerAlert(): { input: number; output: number; calls: number } {
  const all = loadAll().filter((r) => r.kind === "alert-enrich");
  if (all.length === 0) return { input: 0, output: 0, calls: 0 };
  const i = all.reduce((s, r) => s + r.input, 0);
  const o = all.reduce((s, r) => s + r.output, 0);
  return {
    input: Math.round(i / all.length),
    output: Math.round(o / all.length),
    calls: all.length,
  };
}

export function clearUsage(): void {
  const store = ls();
  if (store) { try { store.removeItem(STORAGE_KEY); } catch {} }
  memStore = null;
  const w = windowSummary();
  listeners.forEach((l) => l(w));
}

/** Nicely format a count (k for thousands). */
export function fmtK(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

/** "2h 14m" style duration. */
export function fmtDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
