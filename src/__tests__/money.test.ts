import { describe, test, expect } from "vitest";
import Decimal from "decimal.js";
import { D, STARTING_CASH, asUSD, asOdds, normalizePrice, parseUserDecimal, round2 } from "../lib/money";

describe("money", () => {
  test("starting cash is exactly 1.15 (no float drift)", () => {
    expect(STARTING_CASH.equals(new Decimal("1.15"))).toBe(true);
    expect(asUSD(STARTING_CASH)).toBe("$1.15");
  });

  test("0.1 + 0.2 rounds to 0.30, not 0.300000…04", () => {
    expect(round2(D("0.1").plus(D("0.2"))).toFixed(2)).toBe("0.30");
  });

  test("1.15 - 0.42 equals 0.73 exactly", () => {
    expect(round2(STARTING_CASH.minus(D("0.42"))).toFixed(2)).toBe("0.73");
    expect(asUSD(STARTING_CASH.minus(D("0.42")))).toBe("$0.73");
  });

  test("normalizePrice: 42 → 0.42, 0.42 → 0.42", () => {
    expect(normalizePrice(D("42")).toString()).toBe("0.42");
    expect(normalizePrice(D("0.42")).toString()).toBe("0.42");
  });

  test("asOdds: always two decimals", () => {
    expect(asOdds("0.5")).toBe("0.50");
    expect(asOdds("0.421")).toBe("0.42");
  });

  test("parseUserDecimal: accepts common inputs", () => {
    expect(parseUserDecimal("$1.15")!.toFixed(2)).toBe("1.15");
    expect(parseUserDecimal("1,15")!.toFixed(2)).toBe("1.15");
    expect(parseUserDecimal("")).toBeNull();
    expect(parseUserDecimal("abc")).toBeNull();
  });
});
