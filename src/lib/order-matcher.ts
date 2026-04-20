// Match Polymarket `/trades` results against PolyBot's local pending orders.
//
// When the user places an order on Polymarket and it fills, the filled trade
// appears in their on-chain `/trades` history. We can auto-mark the matching
// pending order filled in PolyBot — closing the "placed real order → remember
// to mark filled in PolyBot" loop.
//
// Matching rules (conservative — must match ALL of):
//   • Trade timestamp > order.placedAt (minus 5-min clock skew)
//   • Same outcome (YES/NO)
//   • Same side (BUY/SELL)
//   • BUY: trade price ≤ order limit  (filled at or better)
//     SELL: trade price ≥ order limit
//   • Trade size > 0
//
// To avoid matching one trade to two orders, we greedily consume trade shares
// against matching orders in placed-at order (oldest first).

import Decimal from "decimal.js";
import { PendingOrder } from "./types";
import { PolyUserTrade } from "./polymarket-user";

export interface MatchResult {
  orderId: string;
  fillShares: Decimal;
  fillPrice: Decimal;
  tradeHash: string;
}

export interface MatcherOptions {
  /** Acceptable clock skew between order placement + on-chain timestamp. */
  clockSkewSeconds?: number;
  /** If the trade condition uses a different identifier than order.marketId,
   * supply a resolver that maps order.marketId → conditionId. */
  resolveConditionId?: (order: PendingOrder) => string | undefined;
}

/** Produce fill-matches for any pending orders that seem to have executed.
 * Returns zero-or-more `MatchResult`s — the caller should feed each into
 * `db.fillOrder(match.orderId, match.fillShares, match.fillPrice)`. */
export function matchTradesToOrders(
  orders: PendingOrder[],
  trades: PolyUserTrade[],
  opts: MatcherOptions = {},
): MatchResult[] {
  const clockSkew = opts.clockSkewSeconds ?? 300;
  const results: MatchResult[] = [];

  // Only open/partial orders can be filled.
  const open = orders
    .filter((o) => o.status === "open" || o.status === "partial")
    .sort((a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime());

  // Clone trades so we can mutate remaining-size without side effects on input.
  const remaining = trades.map((t) => ({ ...t }));

  for (const order of open) {
    const orderPlacedAt = Math.floor(new Date(order.placedAt).getTime() / 1000);
    const orderConditionId = opts.resolveConditionId?.(order) ?? order.marketId;
    const neededShares = new Decimal(order.shares).minus(new Decimal(order.filledShares));
    if (neededShares.lessThanOrEqualTo(0)) continue;

    let remainingToFill = neededShares;

    for (const t of remaining) {
      if (remainingToFill.lessThanOrEqualTo(0)) break;
      if (t.size <= 0) continue;
      if (t.timestamp + clockSkew < orderPlacedAt) continue;
      if (t.conditionId !== orderConditionId) continue;
      if (t.outcome.toUpperCase() !== order.outcome) continue;
      if (t.side !== order.side) continue;

      const limit = new Decimal(order.limitPrice);
      if (order.side === "BUY" && t.price > limit.toNumber() + 1e-9) continue;
      if (order.side === "SELL" && t.price < limit.toNumber() - 1e-9) continue;

      const available = new Decimal(t.size);
      const fill = Decimal.min(available, remainingToFill);

      results.push({
        orderId: order.id,
        fillShares: fill,
        fillPrice: new Decimal(t.price),
        tradeHash: t.transactionHash,
      });

      t.size = available.minus(fill).toNumber();
      remainingToFill = remainingToFill.minus(fill);
    }
  }

  return results;
}
