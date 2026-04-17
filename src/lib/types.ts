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

export interface UserSettings {
  cashBalance: string;           // "1.15" exactly
  allowOverdraft: boolean;
  commandMode: boolean;
  claudeModel: string;
}

export interface DBState {
  settings: UserSettings;
  positions: Position[];
  transactions: Transaction[];
}
