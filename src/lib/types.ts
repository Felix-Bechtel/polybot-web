// Shared types. Prices are in [0,1] (implied probability).

export interface Market {
  id: string;
  question: string;
  yesPrice: string;       // Decimal-as-string. Never Number.
  noPrice: string;
  volume24h: string;
  url?: string;
}

export type Side = "BUY" | "SELL";
export type Outcome = "YES" | "NO";

export interface Position {
  id: string;
  marketId: string;
  marketName: string;
  outcome: Outcome;
  shares: string;         // Decimal string
  avgPrice: string;
  openedAt: string;       // ISO
  updatedAt: string;
}

export interface Transaction {
  id: string;
  createdAt: string;
  marketId: string;
  marketName: string;
  outcome: Outcome;
  side: Side;
  shares: string;
  price: string;
  fees: string;
  notional: string;
  realizedPnl: string;
  notes?: string;
}

export interface AlertThresholds {
  socialSpikePct: number;   // e.g. 200 means mentions ≥ 2× baseline
  priceMovePct: number;     // e.g. 3 means |Δprice| ≥ 3 percentage points
  volumeSpikePct: number;   // e.g. 150 means vol vs last tick ≥ 2.5×
  minMentions: number;      // floor so tiny samples don't fire
}

export interface UserSettings {
  cashBalance: string;           // "1.15" exactly
  allowOverdraft: boolean;
  commandMode: boolean;
  claudeModel: string;
  alertsEnabled: boolean;        // master on/off for the 10-min polling
  alertIntervalMs: number;       // default 600000 (10 min)
  lastCheckedAt: string | null;  // ISO of last completed tick
  watchlist: string[];           // keywords/entities to monitor
  thresholds: AlertThresholds;
  opportunityScan: boolean;      // scan top-volume markets for undervalued candidates
  priceRiseAlertPct: number;     // % above avg price that triggers a portfolio-sell alert
  notificationsEnabled: boolean; // system/browser push notifications on new alerts
}

export type AlertKind =
  | "signal"        // social + price spike (the original kind)
  | "opportunity"   // scanner found an undervalued YES/NO candidate
  | "take-profit"   // user holds a position now priced well above avg
  | "cut-loss";     // user holds a position that collapsed vs avg

export interface Alert {
  id: string;
  createdAt: string;            // ISO
  kind: AlertKind;
  marketId: string;
  marketName: string;
  outcome: Outcome;
  action: Side;                 // BUY | SELL
  priceLimit: string;           // decimal string in [0,1]
  confidence: number;           // 0..100
  rationale: string;
  url?: string;
  // Sizing — how many shares / dollars the scheduler suggests putting in.
  // Absent on older alerts; UI should guard for undefined.
  sizeShares?: string;          // decimal string, rounded 2dp
  sizeDollars?: string;         // decimal string, rounded 2dp
  sizeNote?: string;            // short human reason ("25% of $1.15 cash")
}

export type OrderStatus = "open" | "partial" | "filled" | "cancelled";

/** Mirrors a Polymarket limit order. We don't place anything — Felix sets the
 * limit manually in PolyBot when he places one on Polymarket, then marks fills
 * as they happen. `filledShares` reaches `shares` ⇒ status auto-flips to
 * "filled" and a real Transaction is recorded. */
export interface PendingOrder {
  id: string;
  marketId: string;
  marketName: string;
  outcome: Outcome;
  side: Side;                    // BUY | SELL
  limitPrice: string;            // decimal string in [0,1]
  shares: string;                // requested size
  filledShares: string;          // filled so far (default "0")
  status: OrderStatus;
  placedAt: string;              // ISO
  updatedAt: string;             // ISO
  notes?: string;
  url?: string;                  // deep link to the Polymarket event
}

export interface DBState {
  settings: UserSettings;
  positions: Position[];
  transactions: Transaction[];
  alerts: Alert[];
  pendingOrders: PendingOrder[];
}
