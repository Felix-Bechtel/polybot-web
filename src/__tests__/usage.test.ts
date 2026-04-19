import { describe, it, expect, beforeEach } from "vitest";
import {
  recordUsage, windowSummary, cumulativeTotals, avgPerAlert,
  clearUsage, WINDOW_MS,
} from "../lib/usage";

beforeEach(() => { clearUsage(); });

describe("usage tracker", () => {
  it("records and sums calls within the 5h window", () => {
    recordUsage({ kind: "chat", input: 100, output: 50 });
    recordUsage({ kind: "alert-enrich", input: 200, output: 70 });
    const w = windowSummary();
    expect(w.calls).toBe(2);
    expect(w.totalInput).toBe(300);
    expect(w.totalOutput).toBe(120);
    expect(w.total).toBe(420);
  });

  it("excludes records older than 5h from the window", () => {
    const old = Date.now() - WINDOW_MS - 1000;
    recordUsage({ at: old, kind: "chat", input: 999, output: 999 });
    recordUsage({ kind: "chat", input: 10, output: 20 });
    const w = windowSummary();
    expect(w.calls).toBe(1);
    expect(w.total).toBe(30);
  });

  it("cumulative counts include all records, even old ones", () => {
    const old = Date.now() - WINDOW_MS - 60_000;
    recordUsage({ at: old, kind: "chat", input: 100, output: 50 });
    recordUsage({ kind: "chat", input: 10, output: 20 });
    const cum = cumulativeTotals();
    expect(cum.calls).toBe(2);
    expect(cum.input).toBe(110);
    expect(cum.output).toBe(70);
  });

  it("avgPerAlert only averages alert-enrich calls", () => {
    recordUsage({ kind: "chat", input: 1000, output: 1000 });     // ignored
    recordUsage({ kind: "alert-enrich", input: 200, output: 50 });
    recordUsage({ kind: "alert-enrich", input: 300, output: 70 });
    const a = avgPerAlert();
    expect(a.calls).toBe(2);
    expect(a.input).toBe(250);
    expect(a.output).toBe(60);
  });

  it("resetsAtMs is about 5h after the oldest in-window record", () => {
    const now = Date.now();
    recordUsage({ at: now - 1000, kind: "chat", input: 1, output: 1 });
    const w = windowSummary(now);
    const expected = (now - 1000) + WINDOW_MS;
    expect(Math.abs(w.resetsAtMs - expected)).toBeLessThan(1500);
  });

  it("empty window: reset is WINDOW_MS from now", () => {
    const now = 100_000_000;
    const w = windowSummary(now);
    expect(w.calls).toBe(0);
    expect(w.resetsAtMs).toBe(now + WINDOW_MS);
  });
});
