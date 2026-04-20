import { describe, it, expect } from "vitest";
import { suggestPosition, normalizePolymarketUrl } from "../lib/polymarket";
import { validPolygonAddress } from "../lib/polymarket-user";

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

describe("normalizePolymarketUrl", () => {
  it("rewrites /market/<slug> → /markets?q=<terms>", () => {
    const r = normalizePolymarketUrl("https://polymarket.com/market/foo-bar");
    expect(r).toBe("https://polymarket.com/markets?q=foo%20bar");
  });
  it("strips trailing ISO date from market slug before search", () => {
    const r = normalizePolymarketUrl("https://polymarket.com/market/ceasefire-2026-04-18");
    expect(r).toBe("https://polymarket.com/markets?q=ceasefire");
  });
  it("strips trailing month-day-year suffix from market slug", () => {
    const r = normalizePolymarketUrl("https://polymarket.com/market/ceasefire-april-18-2026");
    expect(r).toBe("https://polymarket.com/markets?q=ceasefire");
  });
  it("rewrites /markets/<slug> → /markets?q=<terms>", () => {
    expect(normalizePolymarketUrl("https://polymarket.com/markets/foo-bar"))
      .toBe("https://polymarket.com/markets?q=foo%20bar");
  });
  it("leaves /event/<slug> URLs unchanged", () => {
    const u = "https://polymarket.com/event/foo-bar";
    expect(normalizePolymarketUrl(u)).toBe(u);
  });
  it("passes non-Polymarket URLs through", () => {
    const u = "https://example.com/market/foo";
    expect(normalizePolymarketUrl(u)).toBe(u);
  });
  it("handles undefined", () => {
    expect(normalizePolymarketUrl(undefined)).toBeUndefined();
  });
});

describe("validPolygonAddress", () => {
  it("accepts a well-formed 0x address", () => {
    expect(validPolygonAddress("0x1234567890AbCdEf1234567890aBcDeF12345678")).toBe(true);
  });
  it("rejects wrong length", () => {
    expect(validPolygonAddress("0x123")).toBe(false);
  });
  it("rejects non-hex chars", () => {
    expect(validPolygonAddress("0xZZZZ567890AbCdEf1234567890aBcDeF12345678")).toBe(false);
  });
  it("rejects missing 0x prefix", () => {
    expect(validPolygonAddress("1234567890AbCdEf1234567890aBcDeF12345678")).toBe(false);
  });
});
