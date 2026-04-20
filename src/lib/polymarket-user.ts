// Polymarket user-data client.
//
// Read-only, no auth. Takes a Polygon wallet address (the "proxy wallet"
// Polymarket creates for each user) and returns their real on-chain
// positions + trade history via Polymarket's public data-api endpoints.
//
// Usage: plug a 0x… address into Settings. PolyBot fetches and reconciles.
// We never hold private keys. We never place orders.

const DATA_API = "https://data-api.polymarket.com";

export interface PolyUserPosition {
  conditionId: string;
  marketSlug?: string;
  eventSlug?: string;
  eventTitle: string;
  outcome: string;               // e.g. "Yes" / "No"
  size: number;                  // shares
  avgPrice: number;              // per-share
  currentPrice: number;          // per-share
  cashPnl: number;               // $
  percentPnl: number;            // %
  url?: string;                  // event URL
}

export interface PolyUserTrade {
  transactionHash: string;
  timestamp: number;             // unix seconds
  conditionId: string;
  marketSlug?: string;
  eventSlug?: string;
  eventTitle: string;
  outcome: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
}

function isAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

async function getJSON(url: string, timeoutMs = 10_000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Fetch current positions for a wallet.
 * Returns [] on bad address, network failure, or empty portfolio. */
export async function fetchUserPositions(address: string): Promise<PolyUserPosition[]> {
  if (!isAddress(address)) return [];
  const url = `${DATA_API}/positions?user=${address.toLowerCase()}&sizeThreshold=0.01`;
  const body = (await getJSON(url)) as Array<Record<string, unknown>> | null;
  if (!Array.isArray(body)) return [];
  return body.map(parsePosition).filter((p): p is PolyUserPosition => p != null);
}

/** Fetch recent trades (last 500 by default). */
export async function fetchUserTrades(address: string, limit = 500): Promise<PolyUserTrade[]> {
  if (!isAddress(address)) return [];
  const url = `${DATA_API}/trades?user=${address.toLowerCase()}&limit=${limit}`;
  const body = (await getJSON(url)) as Array<Record<string, unknown>> | null;
  if (!Array.isArray(body)) return [];
  return body.map(parseTrade).filter((t): t is PolyUserTrade => t != null);
}

function parsePosition(p: Record<string, unknown>): PolyUserPosition | null {
  const conditionId = (p.conditionId ?? p.condition_id) as string | undefined;
  if (!conditionId) return null;
  const size = Number(p.size ?? p.balance ?? 0);
  if (!isFinite(size) || size <= 0) return null;
  const eventSlug = String(p.eventSlug ?? "");
  return {
    conditionId: String(conditionId),
    marketSlug: (p.slug as string | undefined) ?? undefined,
    eventSlug: eventSlug || undefined,
    eventTitle: String(p.title ?? p.eventTitle ?? ""),
    outcome: String(p.outcome ?? ""),
    size,
    avgPrice: Number(p.avgPrice ?? p.averagePrice ?? 0),
    currentPrice: Number(p.curPrice ?? p.currentPrice ?? p.price ?? 0),
    cashPnl: Number(p.cashPnl ?? p.realizedPnl ?? 0),
    percentPnl: Number(p.percentPnl ?? 0),
    url: eventSlug ? `https://polymarket.com/event/${eventSlug}` : undefined,
  };
}

function parseTrade(t: Record<string, unknown>): PolyUserTrade | null {
  const conditionId = (t.conditionId ?? t.condition_id) as string | undefined;
  if (!conditionId) return null;
  const ts = Number(t.timestamp ?? t.ts ?? 0);
  const side = String(t.side ?? "").toUpperCase();
  if (side !== "BUY" && side !== "SELL") return null;
  const eventSlug = String(t.eventSlug ?? "");
  return {
    transactionHash: String(t.transactionHash ?? t.hash ?? ""),
    timestamp: ts,
    conditionId: String(conditionId),
    marketSlug: (t.slug as string | undefined) ?? undefined,
    eventSlug: eventSlug || undefined,
    eventTitle: String(t.title ?? t.eventTitle ?? ""),
    outcome: String(t.outcome ?? ""),
    side: side as "BUY" | "SELL",
    size: Number(t.size ?? 0),
    price: Number(t.price ?? 0),
  };
}

export function validPolygonAddress(s: string): boolean {
  return isAddress(s);
}
