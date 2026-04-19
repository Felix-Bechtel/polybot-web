import { describe, it, expect } from "vitest";
import { suggestSize } from "../lib/sizer";

describe("suggestSize", () => {
  it("BUY: allocates % of cash scaled by confidence", () => {
    const r = suggestSize({
      action: "BUY", priceLimit: "0.50", confidence: 75, cashBalance: "1.15",
    });
    expect(parseFloat(r.dollars)).toBeGreaterThan(0);
    expect(parseFloat(r.shares)).toBeGreaterThan(0);
    // 75% conf → ~30% of cash → ~$0.345
    expect(parseFloat(r.dollars)).toBeCloseTo(0.35, 1);
    // shares = dollars / price ≈ 0.69
    expect(parseFloat(r.shares)).toBeCloseTo(0.69, 1);
    expect(r.pctOfCash).toBe(30);
  });

  it("BUY: floors at 10% allocation even for very low confidence", () => {
    const r = suggestSize({
      action: "BUY", priceLimit: "0.50", confidence: 5, cashBalance: "1.15",
    });
    expect(r.pctOfCash).toBe(10);
  });

  it("BUY: caps at 40% allocation for very high confidence", () => {
    const r = suggestSize({
      action: "BUY", priceLimit: "0.50", confidence: 100, cashBalance: "1.15",
    });
    expect(r.pctOfCash).toBe(40);
  });

  it("BUY: returns 0 when no cash available", () => {
    const r = suggestSize({
      action: "BUY", priceLimit: "0.50", confidence: 80, cashBalance: "0",
    });
    expect(r.dollars).toBe("0");
    expect(r.shares).toBe("0");
  });

  it("SELL: exits 100% of position at high confidence", () => {
    const r = suggestSize({
      action: "SELL", priceLimit: "0.80", confidence: 90, sharesHeld: "2.50",
    });
    expect(r.shares).toBe("2.5");
    expect(parseFloat(r.dollars)).toBeCloseTo(2.0, 2);
  });

  it("SELL: partial exit at medium confidence", () => {
    const r = suggestSize({
      action: "SELL", priceLimit: "0.80", confidence: 60, sharesHeld: "3.00",
    });
    // 60% conf → sell 66% → ~1.98 sh
    expect(parseFloat(r.shares)).toBeCloseTo(1.98, 1);
  });

  it("SELL: returns 0 when no shares held", () => {
    const r = suggestSize({
      action: "SELL", priceLimit: "0.80", confidence: 90, sharesHeld: "0",
    });
    expect(r.shares).toBe("0");
  });
});
