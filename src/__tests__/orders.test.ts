import { describe, it, beforeEach, expect } from "vitest";

// Same localStorage polyfill pattern as db.test.ts — jsdom opaque-origin blocks native.
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  },
});

const { db } = await import("../lib/db");
const Decimal = (await import("decimal.js")).default;

beforeEach(() => { store.clear(); });

describe("pending orders", () => {
  it("placeOrder appends a new open order", () => {
    const o = db.placeOrder({
      marketId: "M1", marketName: "Test", outcome: "YES", side: "BUY",
      limitPrice: new Decimal("0.50"), shares: new Decimal("2"),
    });
    expect(o.status).toBe("open");
    expect(o.filledShares).toBe("0");
    const s = db.load();
    expect(s.pendingOrders).toHaveLength(1);
    expect(s.pendingOrders[0].id).toBe(o.id);
  });

  it("fillOrder 'all' moves to filled + creates a transaction + debits cash", () => {
    const startCash = db.load().settings.cashBalance;
    const o = db.placeOrder({
      marketId: "M1", marketName: "Test", outcome: "YES", side: "BUY",
      limitPrice: new Decimal("0.40"), shares: new Decimal("2"),
    });
    db.fillOrder(o.id, "all");
    const s = db.load();
    const updated = s.pendingOrders.find((x) => x.id === o.id)!;
    expect(updated.status).toBe("filled");
    expect(updated.filledShares).toBe("2");
    expect(s.transactions).toHaveLength(1);
    expect(s.transactions[0].side).toBe("BUY");
    expect(s.transactions[0].notional).toBe("0.8");
    expect(s.settings.cashBalance).toBe(
      new Decimal(startCash).minus("0.8").toDecimalPlaces(2).toString(),
    );
  });

  it("partial fill marks status 'partial' and updates filledShares", () => {
    const o = db.placeOrder({
      marketId: "M1", marketName: "Test", outcome: "YES", side: "BUY",
      limitPrice: new Decimal("0.30"), shares: new Decimal("3"),
    });
    db.fillOrder(o.id, new Decimal("1"));
    const s = db.load();
    const u = s.pendingOrders.find((x) => x.id === o.id)!;
    expect(u.status).toBe("partial");
    expect(u.filledShares).toBe("1");
  });

  it("filling more than remaining throws", () => {
    const o = db.placeOrder({
      marketId: "M1", marketName: "Test", outcome: "YES", side: "BUY",
      limitPrice: new Decimal("0.30"), shares: new Decimal("2"),
    });
    db.fillOrder(o.id, new Decimal("1"));
    expect(() => db.fillOrder(o.id, new Decimal("2"))).toThrow(/fill up to/i);
  });

  it("cancelOrder marks status 'cancelled'", () => {
    const o = db.placeOrder({
      marketId: "M1", marketName: "Test", outcome: "NO", side: "BUY",
      limitPrice: new Decimal("0.20"), shares: new Decimal("1"),
    });
    db.cancelOrder(o.id);
    expect(db.load().pendingOrders.find((x) => x.id === o.id)!.status).toBe("cancelled");
  });

  it("cancelled / filled orders are immutable: fill throws", () => {
    const o = db.placeOrder({
      marketId: "M1", marketName: "Test", outcome: "YES", side: "BUY",
      limitPrice: new Decimal("0.20"), shares: new Decimal("1"),
    });
    db.cancelOrder(o.id);
    expect(() => db.fillOrder(o.id, "all")).toThrow(/cancelled/);
  });
});
