// Position sizer — how many shares + dollars to put into a single trade.
//
// For a $1.15 starting bankroll the math has to land on sensible
// sub-dollar values. The rule:
//   • Cap at max 40% of cash per trade.
//   • Scale allocation linearly with confidence (50%→20%, 75%→30%, 100%→40%).
//   • For take-profit / cut-loss on an existing position, size uses the
//     position's share count, not cash.

import Decimal from "decimal.js";

export interface SizerInput {
  action: "BUY" | "SELL";
  priceLimit: string;            // per-share, [0,1]
  confidence: number;            // 0..100
  cashBalance?: string;          // available cash for BUYs
  sharesHeld?: string;           // shares you currently own (for SELLs)
}

export interface SizerOutput {
  shares: string;                // decimal string, rounded to 2 dp
  dollars: string;               // decimal string, rounded to 2 dp
  pctOfCash?: number;            // BUYs only — % of cash allocated
  reason: string;                // short human-readable summary
}

const MIN_BUY_PCT = 10;          // always risk at least 10% of cash if we BUY
const MAX_BUY_PCT = 40;          // never risk more than 40% on one trade

export function suggestSize(input: SizerInput): SizerOutput {
  const price = new Decimal(input.priceLimit);
  const conf = Math.max(0, Math.min(100, input.confidence));

  if (input.action === "SELL" && input.sharesHeld) {
    // Portfolio exit — suggest selling a fraction of the existing position.
    const held = new Decimal(input.sharesHeld);
    if (held.lessThanOrEqualTo(0)) {
      return { shares: "0", dollars: "0", reason: "nothing to sell" };
    }
    // At high confidence (≥75) exit the whole position; otherwise a portion.
    const exitPct = conf >= 75 ? 100 : conf >= 50 ? 66 : 33;
    const shares = held.mul(exitPct).div(100);
    const dollars = shares.mul(price);
    return {
      shares: shares.toDecimalPlaces(2).toString(),
      dollars: dollars.toDecimalPlaces(2).toString(),
      reason: `Sell ${exitPct}% of your ${held.toString()}-share position`,
    };
  }

  // BUY path (also used when alert kind = "signal"/"opportunity").
  const cash = new Decimal(input.cashBalance ?? "0");
  if (cash.lessThanOrEqualTo(0) || price.lessThanOrEqualTo(0)) {
    return { shares: "0", dollars: "0", pctOfCash: 0, reason: "no cash available" };
  }
  const pct = Math.round(Math.max(MIN_BUY_PCT, Math.min(MAX_BUY_PCT, conf * 0.4)));
  const dollars = cash.mul(pct).div(100);
  const shares = dollars.div(price);
  return {
    shares: shares.toDecimalPlaces(2).toString(),
    dollars: dollars.toDecimalPlaces(2).toString(),
    pctOfCash: pct,
    reason: `${pct}% of $${cash.toDecimalPlaces(2).toString()} cash`,
  };
}

/** Short one-line summary for notification bodies / tight chip labels. */
export function sizingLine(s: SizerOutput): string {
  if (new Decimal(s.dollars).isZero()) return s.reason;
  return `~${s.shares} sh · $${s.dollars}`;
}
