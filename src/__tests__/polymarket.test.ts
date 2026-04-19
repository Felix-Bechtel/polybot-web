import { describe, it, expect } from "vitest";
import { suggestPosition } from "../lib/polymarket";

const mk = (yes: string, vol = "10000") => ({
  id: "x", question: "Q?", yesPrice: yes, noPrice: String(1 - parseFloat(yes)),
  volume24h: vol, url: undefined,
});

describe("suggestPosition", () => {
  it("recommends BUY YES when yes ≤ 0.25", () => {
    const r = suggestPosition(mk("0.20"));
    expect(r.side).toBe("YES");
    expect(r.confidence).toBeGreaterThan(0);
  });
  it("recommends BUY NO when yes ≥ 0.75", () => {
    const r = suggestPosition(mk("0.85"));
    expect(r.side).toBe("NO");
  });
  it("leans YES for 0.60..0.74", () => {
    const r = suggestPosition(mk("0.65"));
    expect(r.side).toBe("YES");
  });
  it("leans NO for 0.26..0.40", () => {
    const r = suggestPosition(mk("0.30"));
    expect(r.side).toBe("NO");
  });
  it("recommends HOLD in the 0.40..0.60 middle", () => {
    const r = suggestPosition(mk("0.50"));
    expect(r.side).toBe("HOLD");
  });
  it("confidence rises with higher volume", () => {
    const low = suggestPosition(mk("0.20", "100"));
    const high = suggestPosition(mk("0.20", "10000000"));
    expect(high.confidence).toBeGreaterThan(low.confidence);
  });
});
