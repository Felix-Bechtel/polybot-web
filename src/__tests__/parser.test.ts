import { describe, test, expect } from "vitest";
import { parse, parseStrict, parseNatural } from "../lib/parser";

describe("parser", () => {
  test("strict sell", () => {
    const t = parseStrict("(sell) ClimatePolicyMarket Yes 10");
    expect(t?.side).toBe("SELL");
    expect(t?.outcome).toBe("YES");
    expect(t?.shares.toString()).toBe("10");
    expect(t?.marketId).toBe("ClimatePolicyMarket");
  });

  test("strict buy with explicit price", () => {
    const t = parseStrict("(buy) POLY-BTC-100K No 5 at 0.45");
    expect(t?.side).toBe("BUY");
    expect(t?.outcome).toBe("NO");
    expect(t?.price?.toString()).toBe("0.45");
  });

  test("natural language with price as cents is normalized to fraction", () => {
    const t = parse("i bought 10 yes on ClimatePolicyMarket at 42");
    expect(t?.side).toBe("BUY");
    expect(t?.price?.toString()).toBe("0.42");
  });

  test("natural with full sentence + date", () => {
    const t = parseNatural("Record that I sold 5 shares of MarketX at $0.32 each on 2026-01-01");
    expect(t?.side).toBe("SELL");
    expect(t?.shares.toString()).toBe("5");
    expect(t?.price?.toString()).toBe("0.32");
    expect(t?.date).toBeDefined();
  });

  test("gibberish returns null", () => {
    expect(parse("zzz random text")).toBeNull();
  });
});
