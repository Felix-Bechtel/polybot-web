// localStorage-backed persistence. Decimal math via Decimal.js.
// All writes validated. Never auto-trades. Never talks to any SMS service.

import Decimal from "decimal.js";
import {
  DBState, Outcome, Position, Side, Transaction, UserSettings,
} from "./types";
import { D, STARTING_CASH, round2 } from "./money";

const STORAGE_KEY = "polybot.state.v1";

function defaultState(): DBState {
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

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Lightweight pub/sub so React components re-render when the DB changes.
type Listener = (state: DBState) => void;
const listeners = new Set<Listener>();

export const db = {
  load(): DBState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw) as Partial<DBState>;
      return {
        settings: { ...defaultState().settings, ...(parsed.settings ?? {}) },
        positions: parsed.positions ?? [],
        transactions: parsed.transactions ?? [],
      };
    } catch {
      return defaultState();
    }
  },

  save(state: DBState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    listeners.forEach((l) => l(state));
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    listeners.forEach((l) => l(defaultState()));
  },

  setSettings(patch: Partial<UserSettings>): void {
    const s = db.load();
    s.settings = { ...s.settings, ...patch };
    db.save(s);
  },

  findPosition(marketId: string, outcome: Outcome,
               state: DBState = db.load()): Position | undefined {
    return state.positions.find(
      (p) => p.marketId === marketId && p.outcome === outcome
    );
  },

  recordBuy(input: {
    marketId: string; marketName: string; outcome: Outcome;
    shares: Decimal; price: Decimal; fees?: Decimal;
    notes?: string; date?: Date;
  }): Transaction {
    const { marketId, marketName, outcome } = input;
    const shares = input.shares, price = input.price;
    const fees = input.fees ?? new Decimal(0);
    const date = (input.date ?? new Date()).toISOString();

    validate(shares, price);
    const notional = round2(shares.mul(price).plus(fees));
    const state = db.load();
    const cash = D(state.settings.cashBalance);
    if (!state.settings.allowOverdraft && notional.greaterThan(cash)) {
      throw new Error(
        `Insufficient cash: need $${notional.toFixed(2)}, have $${cash.toFixed(2)}. ` +
        `Enable "Allow overdraft" in Settings to permit negative balance.`
      );
    }

    // Upsert position with weighted-average cost.
    const existing = db.findPosition(marketId, outcome, state);
    let position: Position;
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
    } else {
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

    const tx: Transaction = {
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

  recordSell(input: {
    marketId: string; outcome: Outcome; shares: Decimal; price: Decimal;
    fees?: Decimal; notes?: string; date?: Date;
  }): Transaction {
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
    } else {
      state.positions = state.positions.map((p) =>
        p.id === pos.id ? { ...p, shares: newShares.toString(), updatedAt: date } : p,
      );
    }

    const cash = D(state.settings.cashBalance);
    state.settings.cashBalance = round2(cash.plus(proceeds)).toString();

    const tx: Transaction = {
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

function validate(shares: Decimal, price: Decimal): void {
  if (!shares.greaterThan(0)) throw new Error("shares must be > 0");
  if (price.lessThan(0) || price.greaterThan(1)) {
    throw new Error("price must be between 0 and 1");
  }
}

// Re-export so `import { Side }` from "./db" works if wanted.
export type { Side, Outcome };
