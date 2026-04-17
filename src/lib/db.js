// localStorage-backed persistence. Decimal math via Decimal.js.
// All writes validated. Never auto-trades. Never talks to any SMS service.
import Decimal from "decimal.js";
import { D, STARTING_CASH, round2 } from "./money";
const STORAGE_KEY = "polybot.state.v1";
function defaultState() {
    return {
        settings: {
            cashBalance: STARTING_CASH.toString(),
            allowOverdraft: false,
            commandMode: false,
            claudeModel: "claude-haiku-4-5",
        },
        positions: [],
        transactions: [],
    };
}
function uuid() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto)
        return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
const listeners = new Set();
export const db = {
    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw)
                return defaultState();
            const parsed = JSON.parse(raw);
            return {
                settings: { ...defaultState().settings, ...(parsed.settings ?? {}) },
                positions: parsed.positions ?? [],
                transactions: parsed.transactions ?? [],
            };
        }
        catch {
            return defaultState();
        }
    },
    save(state) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        listeners.forEach((l) => l(state));
    },
    subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },
    reset() {
        localStorage.removeItem(STORAGE_KEY);
        listeners.forEach((l) => l(defaultState()));
    },
    setSettings(patch) {
        const s = db.load();
        s.settings = { ...s.settings, ...patch };
        db.save(s);
    },
    findPosition(marketId, outcome, state = db.load()) {
        return state.positions.find((p) => p.marketId === marketId && p.outcome === outcome);
    },
    recordBuy(input) {
        const { marketId, marketName, outcome } = input;
        const shares = input.shares, price = input.price;
        const fees = input.fees ?? new Decimal(0);
        const date = (input.date ?? new Date()).toISOString();
        validate(shares, price);
        const notional = round2(shares.mul(price).plus(fees));
        const state = db.load();
        const cash = D(state.settings.cashBalance);
        if (!state.settings.allowOverdraft && notional.greaterThan(cash)) {
            throw new Error(`Insufficient cash: need $${notional.toFixed(2)}, have $${cash.toFixed(2)}. ` +
                `Enable "Allow overdraft" in Settings to permit negative balance.`);
        }
        // Upsert position with weighted-average cost.
        const existing = db.findPosition(marketId, outcome, state);
        let position;
        if (existing) {
            const prevShares = D(existing.shares), prevAvg = D(existing.avgPrice);
            const newShares = prevShares.plus(shares);
            const newCost = prevShares.mul(prevAvg).plus(shares.mul(price));
            const newAvg = newShares.isZero() ? new Decimal(0) : newCost.div(newShares);
            position = {
                ...existing,
                shares: newShares.toString(),
                avgPrice: newAvg.toDecimalPlaces(6).toString(),
                updatedAt: date,
            };
            state.positions = state.positions.map((p) => (p.id === existing.id ? position : p));
        }
        else {
            position = {
                id: uuid(),
                marketId, marketName,
                outcome,
                shares: shares.toString(),
                avgPrice: price.toDecimalPlaces(6).toString(),
                openedAt: date, updatedAt: date,
            };
            state.positions.push(position);
        }
        const tx = {
            id: uuid(), createdAt: date,
            marketId, marketName, outcome, side: "BUY",
            shares: shares.toString(), price: price.toString(),
            fees: fees.toString(), notional: notional.toString(),
            realizedPnl: "0", notes: input.notes,
        };
        state.transactions.unshift(tx);
        state.settings.cashBalance = round2(cash.minus(notional)).toString();
        db.save(state);
        return tx;
    },
    recordSell(input) {
        const shares = input.shares, price = input.price;
        const fees = input.fees ?? new Decimal(0);
        const date = (input.date ?? new Date()).toISOString();
        validate(shares, price);
        const state = db.load();
        const pos = db.findPosition(input.marketId, input.outcome, state);
        if (!pos || D(pos.shares).lessThan(shares)) {
            throw new Error("You don't hold that many shares on this outcome.");
        }
        const avg = D(pos.avgPrice);
        const proceeds = round2(shares.mul(price).minus(fees));
        const realized = round2(price.minus(avg).mul(shares).minus(fees));
        const newShares = D(pos.shares).minus(shares);
        if (newShares.isZero()) {
            state.positions = state.positions.filter((p) => p.id !== pos.id);
        }
        else {
            state.positions = state.positions.map((p) => p.id === pos.id ? { ...p, shares: newShares.toString(), updatedAt: date } : p);
        }
        const cash = D(state.settings.cashBalance);
        state.settings.cashBalance = round2(cash.plus(proceeds)).toString();
        const tx = {
            id: uuid(), createdAt: date,
            marketId: input.marketId, marketName: pos.marketName,
            outcome: input.outcome, side: "SELL",
            shares: shares.toString(), price: price.toString(),
            fees: fees.toString(), notional: proceeds.toString(),
            realizedPnl: realized.toString(), notes: input.notes,
        };
        state.transactions.unshift(tx);
        db.save(state);
        return tx;
    },
};
function validate(shares, price) {
    if (!shares.greaterThan(0))
        throw new Error("shares must be > 0");
    if (price.lessThan(0) || price.greaterThan(1)) {
        throw new Error("price must be between 0 and 1");
    }
}
