// Read-only Polymarket Gamma REST wrapper + offline seed fallback.
// Never trades. Never holds keys. Failures return [].

import { Market } from "./types";
import seed from "../seed.json";

const GAMMA = "https://gamma-api.polymarket.com";

function parsePrices(raw: unknown): [string, string] {
  let arr: unknown = raw;
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr); } catch { arr = null; }
  }
  if (Array.isArray(arr) && arr.length >= 2) {
    const y = String(arr[0] ?? "0.5"), n = String(arr[1] ?? "0.5");
    return [y, n];
  }
  return ["0.5", "0.5"];
}

async function getJSON(url: string, timeoutMs = 9000): Promise<unknown> {
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

export async function fetchTopMarkets(limit = 30): Promise<Market[]> {
  try {
    const url = `${GAMMA}/markets?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`;
    const arr = (await getJSON(url)) as Array<Record<string, unknown>> | null;
    if (!Array.isArray(arr)) return seedMarkets();
    return arr.map(parse).filter(Boolean) as Market[];
  } catch {
    return seedMarkets();
  }
}

export async function fetchMarket(idOrQuery: string): Promise<Market | undefined> {
  const all = await fetchTopMarkets(200);
  const q = idOrQuery.toLowerCase();
  return all.find(
    (m) => m.id.toLowerCase() === q || m.question.toLowerCase().includes(q),
  );
}

/** Full-text search Polymarket markets.
 *
 * Strategy: run (a) Gamma public-search server-side full-text AND (b) a wide
 * Gamma sweep in parallel, merging results. That way typos, slug-style
 * queries, and long-tail markets still surface even when public-search misses.
 */
export async function searchMarkets(query: string, limit = 60): Promise<Market[]> {
  const q = query.trim();
  if (!q) return [];

  const [server, sweep] = await Promise.all([
    publicSearch(q, limit).catch(() => [] as Market[]),
    sweepSearch(q, limit).catch(() => [] as Market[]),
  ]);

  // Merge, preserve order (server hits first — they tend to be more relevant).
  const seen = new Set<string>();
  const out: Market[] = [];
  for (const m of [...server, ...sweep]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id); out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

async function sweepSearch(q: string, limit: number): Promise<Market[]> {
  const qLower = q.toLowerCase();
  const [m1, m2] = await Promise.all([
    getJSON(`${GAMMA}/markets?limit=500&active=true&closed=false&order=volume24hr&ascending=false`) as Promise<Array<Record<string, unknown>> | null>,
    getJSON(`${GAMMA}/events?limit=500&active=true&closed=false&order=volume24hr&ascending=false`) as Promise<Array<Record<string, unknown>> | null>,
  ]);
  const out: Market[] = [];
  if (Array.isArray(m1)) {
    for (const m of m1) {
      const p = parse(m);
      if (p && (p.question.toLowerCase().includes(qLower) || p.id.toLowerCase().includes(qLower))) {
        out.push(p);
      }
    }
  }
  if (Array.isArray(m2)) {
    for (const ev of m2) {
      const title = String(ev.title ?? ev.question ?? "").toLowerCase();
      const slug = String(ev.slug ?? "").toLowerCase();
      const tags = Array.isArray(ev.tags) ? (ev.tags as unknown[]).map((t) => String(t).toLowerCase()) : [];
      const eventMatches = title.includes(qLower) || slug.includes(qLower) || tags.some((t) => t.includes(qLower));
      const sub = (ev as { markets?: Array<Record<string, unknown>> }).markets ?? [];
      for (const m of sub) {
        const p = parse(m);
        if (!p) continue;
        if (eventMatches || p.question.toLowerCase().includes(qLower)) {
          out.push(p);
        }
      }
    }
  }
  return out.slice(0, limit);
}

/** Server-side full-text search via Gamma public-search. */
async function publicSearch(q: string, limit: number): Promise<Market[]> {
  const url = `${GAMMA}/public-search?q=${encodeURIComponent(q)}&limit_per_type=${limit}&events_status=active`;
  const body = (await getJSON(url, 8000)) as {
    events?: Array<Record<string, unknown>>;
    markets?: Array<Record<string, unknown>>;
  } | null;
  if (!body) return [];
  const out: Market[] = [];
  for (const m of body.markets ?? []) { const p = parse(m); if (p) out.push(p); }
  for (const ev of body.events ?? []) {
    const mkts = (ev as { markets?: Array<Record<string, unknown>> }).markets ?? [];
    for (const m of mkts) { const p = parse(m); if (p) out.push(p); }
  }
  const seen = new Set<string>();
  return out.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id); return true;
  }).slice(0, limit);
}

/** Scored "value" opportunities across the top of the book.
 *
 * Pulls a wide sample (800) and scores for:
 *   • Cheap YES with room to grow (0.10–0.60)
 *   • Underpriced near-winners (0.62–0.92)
 * Scoring combines liquidity, distance from 50%, and inverse-price for cheap.
 * Guarantees ≥ limit results by relaxing the liquidity floor if needed.
 */
export async function fetchOpportunities(limit = 25): Promise<Market[]> {
  const top = await fetchTopMarkets(800);
  const score = (m: Market, minVol: number): number | null => {
    const yes = parseFloat(m.yesPrice);
    const vol = parseFloat(m.volume24h);
    if (!isFinite(yes) || !isFinite(vol) || vol < minVol) return null;
    const cheap = yes >= 0.10 && yes <= 0.60;
    const nearWin = yes >= 0.62 && yes <= 0.92;
    if (!cheap && !nearWin) return null;
    const dist = Math.abs(yes - 0.5);
    return Math.log10(vol + 1) * (1 + dist * 2) * (cheap ? (1 / Math.max(0.06, yes)) : 1.25);
  };
  for (const floor of [5_000, 1_000, 100, 0]) {
    const ranked = top
      .map((m) => ({ m, s: score(m, floor) }))
      .filter((x): x is { m: Market; s: number } => x.s != null)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.m);
    if (ranked.length >= limit) return ranked;
  }
  return top.slice(0, limit);
}

/** Pull active markets for a keyword bundle (category tab). Merges results
 * across all terms, dedupes, and sorts by 24h volume. */
export async function fetchCategoryMarkets(terms: string[], limit = 25): Promise<Market[]> {
  if (terms.length === 0) return [];
  const chunks = await Promise.all(terms.map((t) => searchMarkets(t, 40).catch(() => [])));
  const seen = new Set<string>();
  const all: Market[] = [];
  for (const chunk of chunks) {
    for (const m of chunk) {
      if (seen.has(m.id)) continue;
      seen.add(m.id); all.push(m);
    }
  }
  all.sort((a, b) => parseFloat(b.volume24h) - parseFloat(a.volume24h));
  return all.slice(0, limit);
}

/** Heuristic buy-side suggestion for a single market card. */
export interface PositionSuggestion {
  side: "YES" | "NO" | "HOLD";
  confidence: number;  // 0–100
  reason: string;
}

export function suggestPosition(m: Market): PositionSuggestion {
  const yes = parseFloat(m.yesPrice);
  const vol = parseFloat(m.volume24h);
  if (!isFinite(yes)) return { side: "HOLD", confidence: 0, reason: "no price" };
  const liquidityBonus = Math.max(0, Math.min(30, Math.log10(Math.max(1, vol)) * 8));
  if (yes <= 0.25) {
    return {
      side: "YES",
      confidence: Math.min(80, Math.round(35 + (0.25 - yes) * 200 + liquidityBonus)),
      reason: `YES is cheap at ${(yes * 100).toFixed(0)}¢ — upside room`,
    };
  }
  if (yes >= 0.75) {
    const no = 1 - yes;
    return {
      side: "NO",
      confidence: Math.min(75, Math.round(30 + (yes - 0.75) * 200 + liquidityBonus)),
      reason: `NO is cheap at ${(no * 100).toFixed(0)}¢ — contrarian value`,
    };
  }
  if (yes >= 0.60) {
    return {
      side: "YES",
      confidence: Math.min(70, Math.round(35 + (yes - 0.60) * 200 + liquidityBonus)),
      reason: `Lean YES — market leaning ${(yes * 100).toFixed(0)}% with room`,
    };
  }
  if (yes <= 0.40) {
    return {
      side: "NO",
      confidence: Math.min(70, Math.round(35 + (0.40 - yes) * 200 + liquidityBonus)),
      reason: `Lean NO — market leaning ${((1 - yes) * 100).toFixed(0)}% with room`,
    };
  }
  return {
    side: "HOLD",
    confidence: Math.round(20 + liquidityBonus / 3),
    reason: `Tossup @ ${(yes * 100).toFixed(0)}¢ — no edge`,
  };
}

function parse(m: Record<string, unknown>): Market | null {
  const id = (m.conditionId ?? m.id ?? m.slug) as string | undefined;
  if (!id) return null;
  const [yes, no] = parsePrices(m.outcomePrices ?? m.outcome_prices);
  const vol = String(m.volume24hr ?? m.volume24h ?? m.volume ?? 0);
  // Polymarket removed /market/<slug> — canonical URL is /event/<event-slug>.
  // Gamma returns an `events` array on each market with the parent event's slug.
  const events = (m.events as Array<{ slug?: string }> | undefined) ?? [];
  const eventSlug = events[0]?.slug;
  const marketSlug = (m.slug as string | undefined) ?? "";
  const url = eventSlug
    ? `https://polymarket.com/event/${eventSlug}`
    : marketSlug
      ? `https://polymarket.com/event/${marketSlug}`   // best-effort fallback
      : undefined;
  return {
    id: String(id),
    question: (m.question as string) ?? (m.title as string) ?? "",
    yesPrice: yes, noPrice: no,
    volume24h: vol,
    url,
  };
}

/** Offline fallback — bundled 5 markets. */
export function seedMarkets(): Market[] {
  const s = seed as { markets: Market[] };
  return s.markets;
}

/** Rewrite any old `/market/<slug>` URL to the working `/event/<slug>` form.
 * Applies to historical alerts/transactions that were stored before the URL
 * fix landed, so every link renders correctly without a migration pass. */
export function normalizePolymarketUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.hostname === "polymarket.com" && u.pathname.startsWith("/market/")) {
      u.pathname = "/event/" + u.pathname.slice("/market/".length);
      return u.toString();
    }
    if (u.hostname === "polymarket.com" && u.pathname.startsWith("/markets/")) {
      u.pathname = "/event/" + u.pathname.slice("/markets/".length);
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}
