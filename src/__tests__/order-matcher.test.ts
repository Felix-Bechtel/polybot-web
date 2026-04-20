import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { matchTradesToOrders } from "../lib/order-matcher";
import { PendingOrder } from "../lib/types";
import { PolyUserTrade } from "../lib/polymarket-user";

const baseOrder = (overrides: Partial<PendingOrder> = {}): PendingOrder => ({
  id: overrides.id ?? "o1",
  marketId: "C1",
  marketName: "Test market",
  outcome: "YES",
  side: "BUY",
  limitPrice: "0.50",
  shares: "2",
  filledShares: "0",
  status: "open",
  placedAt: "2026-04-19T12:00:00Z",
  updatedAt: "2026-04-19T12:00:00Z",
  ...overrides,
});

const baseTrade = (overrides: Partial<PolyUserTrade> = {}): PolyUserTrade => ({
  transactionHash: "0xabc",
  timestamp: Math.floor(new Date("2026-04-19T12:01:00Z").getTime() / 1000),
  conditionId: "C1",
  eventTitle: "Test",
  outcome: "YES",
  side: "BUY",
  size: 2,
  price: 0.50,
  ...overrides,
});

describe("matchTradesToOrders", () => {
  it("matches a simple full-fill BUY at the limit price", () => {
    const r = matchTradesToOrders([baseOrder()], [baseTrade()]);
    expect(r).toHaveLength(1);
    expect(r[0].orderId).toBe("o1");
    expect(r[0].fillShares.toString()).toBe("2");
    expect(r[0].fillPrice.toNumber()).toBe(0.50);
  });

  it("matches BUY filled below limit price (better fill)", () => {
    const r = matchTradesToOrders(
      [baseOrder({ limitPrice: "0.60" })],
      [baseTrade({ price: 0.45 })],
    );
    expect(r).toHaveLength(1);
    expect(r[0].fillPrice.toNumber()).toBe(0.45);
  });

  it("does NOT match BUY when trade price > limit", () => {
    const r = matchTradesToOrders(
      [baseOrder({ limitPrice: "0.40" })],
      [baseTrade({ price: 0.50 })],
    );
    expect(r).toHaveLength(0);
  });

  it("does NOT match SELL when trade price < limit", () => {
    const r = matchTradesToOrders(
      [baseOrder({ side: "SELL", limitPrice: "0.60" })],
      [baseTrade({ side: "SELL", price: 0.50 })],
    );
    expect(r).toHaveLength(0);
  });

  it("matches SELL at or above the limit price", () => {
    const r = matchTradesToOrders(
      [baseOrder({ side: "SELL", limitPrice: "0.55" })],
      [baseTrade({ side: "SELL", price: 0.60 })],
    );
    expect(r).toHaveLength(1);
    expect(r[0].fillPrice.toNumber()).toBe(0.60);
  });

  it("ignores trades with mismatched outcome", () => {
    const r = matchTradesToOrders(
      [baseOrder()],  // YES
      [baseTrade({ outcome: "NO" })],
    );
    expect(r).toHaveLength(0);
  });

  it("ignores trades placed before the order was submitted (beyond skew)", () => {
    const r = matchTradesToOrders(
      [baseOrder()], // placed 12:00 UTC
      [baseTrade({ timestamp: Math.floor(new Date("2026-04-19T11:00:00Z").getTime() / 1000) })],
    );
    expect(r).toHaveLength(0);
  });

  it("allows up to 5 minutes of clock skew by default", () => {
    const orderTime = new Date("2026-04-19T12:00:00Z").getTime();
    const r = matchTradesToOrders(
      [baseOrder()],
      [baseTrade({ timestamp: Math.floor(orderTime / 1000) - 60 })], // 1 min before, within skew
    );
    expect(r).toHaveLength(1);
  });

  it("partial fills produce one result with available size", () => {
    const r = matchTradesToOrders(
      [baseOrder({ shares: "5" })],
      [baseTrade({ size: 2 })],
    );
    expect(r).toHaveLength(1);
    expect(r[0].fillShares.toString()).toBe("2");
  });

  it("respects filledShares — only fills the remaining portion", () => {
    const r = matchTradesToOrders(
      [baseOrder({ shares: "5", filledShares: "2", status: "partial" })],
      [baseTrade({ size: 10 })],
    );
    expect(r).toHaveLength(1);
    expect(r[0].fillShares.toString()).toBe("3");
  });

  it("splits one trade across multiple orders greedily (oldest first)", () => {
    const older = baseOrder({ id: "o-older", shares: "1", placedAt: "2026-04-19T11:00:00Z" });
    const newer = baseOrder({ id: "o-newer", shares: "1", placedAt: "2026-04-19T11:30:00Z" });
    const r = matchTradesToOrders([newer, older], [baseTrade({ size: 1.5 })]);
    // Older gets filled fully (1 share), newer gets the remaining 0.5
    expect(r).toHaveLength(2);
    expect(r[0].orderId).toBe("o-older");
    expect(r[0].fillShares.toString()).toBe("1");
    expect(r[1].orderId).toBe("o-newer");
    expect(r[1].fillShares.toString()).toBe("0.5");
  });

  it("skips already-filled or cancelled orders", () => {
    const r = matchTradesToOrders(
      [baseOrder({ status: "filled" }), baseOrder({ id: "o2", status: "cancelled" })],
      [baseTrade()],
    );
    expect(r).toHaveLength(0);
  });
});
