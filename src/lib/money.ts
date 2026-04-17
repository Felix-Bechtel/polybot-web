// Money math. ALL currency values flow through Decimal — never `number`.
// Starting cash uses the string constructor `new Decimal("1.15")` so the
// balance is *exactly* 1.15 and never 1.1499999999 (the classic IEEE-754 bug).

import Decimal from "decimal.js";

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_EVEN });

export const STARTING_CASH = new Decimal("1.15");

export function D(v: string | number | Decimal): Decimal {
  if (v instanceof Decimal) return v;
  if (typeof v === "number") return new Decimal(v.toString()); // via string to avoid FP
  const s = String(v).trim().replace("$", "").replace(",", ".");
  return new Decimal(s === "" ? "0" : s);
}

/** Round to 2 decimals (USD) */
export function round2(v: string | number | Decimal): Decimal {
  return D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}

/** "$1.15" — always two decimals, en-US formatted */
export function asUSD(v: string | number | Decimal): string {
  const n = round2(v).toNumber();
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/** "0.42" — two-decimal odds form */
export function asOdds(v: string | number | Decimal): string {
  return D(v).toFixed(2);
}

/** Parse user input that may be "42" → 0.42, "$1.15" → 1.15, ".3" → 0.3 */
export function parseUserDecimal(s: string): Decimal | null {
  const t = s.trim();
  if (!t) return null;
  try {
    const d = D(t);
    return d.isNaN() ? null : d;
  } catch {
    return null;
  }
}

/** If a price is entered as cents-style (e.g. "42"), normalize to [0,1]. */
export function normalizePrice(d: Decimal): Decimal {
  return d.greaterThan(1) ? d.div(100) : d;
}
