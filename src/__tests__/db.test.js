import { describe, beforeEach, test, expect } from "vitest";
import Decimal from "decimal.js";
// Bulletproof localStorage polyfill — jsdom opaque-origin blocks the native one.
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, String(v)),
        removeItem: (k) => void store.delete(k),
        clear: () => store.clear(),
        key: (i) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; },
    },
});
// Import AFTER polyfill so top-level module code sees our shim.
const { db } = await import("../lib/db");
const { D } = await import("../lib/money");
beforeEach(() => { localStorage.clear(); db.reset(); });
describe("db", () => {
    test("fresh install starts with exactly $1.15", () => {
        const s = db.load();
        expect(s.settings.cashBalance).toBe("1.15");
        expect(s.positions.length).toBe(0);
        expect(s.transactions.length).toBe(0);
    });
    test("BUY deducts cash, creates position", () => {
        db.recordBuy({
            marketId: "POLY-BTC-100K", marketName: "BTC",
            outcome: "YES", shares: D("1"), price: D("0.42"),
        });
        const s = db.load();
        expect(s.settings.cashBalance).toBe("0.73"); // 1.15 - 0.42, EXACT
        expect(s.positions[0].shares).toBe("1");
        expect(s.positions[0].avgPrice).toBe("0.42");
    });
    test("weighted avg across two BUYs", () => {
        db.recordBuy({ marketId: "M", marketName: "M",
            outcome: "YES", shares: D("1"), price: D("0.20") });
        db.recordBuy({ marketId: "M", marketName: "M",
            outcome: "YES", shares: D("1"), price: D("0.40") });
        const s = db.load();
        expect(new Decimal(s.positions[0].avgPrice).toFixed(2)).toBe("0.30");
    });
    test("BUY blocks on insufficient cash unless overdraft enabled", () => {
        expect(() => db.recordBuy({ marketId: "M", marketName: "M", outcome: "YES",
            shares: D("100"), price: D("0.5") })).toThrow(/Insufficient cash/);
        db.setSettings({ allowOverdraft: true });
        expect(() => db.recordBuy({ marketId: "M", marketName: "M", outcome: "YES",
            shares: D("100"), price: D("0.5") })).not.toThrow();
    });
    test("SELL realizes P&L correctly", () => {
        db.recordBuy({ marketId: "M", marketName: "M", outcome: "YES",
            shares: D("2"), price: D("0.30") });
        db.recordSell({ marketId: "M", outcome: "YES",
            shares: D("1"), price: D("0.50") });
        const s = db.load();
        expect(s.settings.cashBalance).toBe("1.05"); // 1.15 - 0.60 + 0.50
        expect(s.transactions[0].realizedPnl).toBe("0.2");
    });
    test("SELL fails on over-shares", () => {
        db.recordBuy({ marketId: "M", marketName: "M", outcome: "YES",
            shares: D("1"), price: D("0.3") });
        expect(() => db.recordSell({ marketId: "M", outcome: "YES",
            shares: D("5"), price: D("0.5") })).toThrow(/don't hold/);
    });
});
