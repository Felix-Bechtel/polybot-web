// Read-only Polymarket Gamma REST wrapper + offline seed fallback.
// Never trades. Never holds keys. Failures return [].
import seed from "../seed.json";
const GAMMA = "https://gamma-api.polymarket.com";
function parsePrices(raw) {
    let arr = raw;
    if (typeof arr === "string") {
        try {
            arr = JSON.parse(arr);
        }
        catch {
            arr = null;
        }
    }
    if (Array.isArray(arr) && arr.length >= 2) {
        const y = String(arr[0] ?? "0.5"), n = String(arr[1] ?? "0.5");
        return [y, n];
    }
    return ["0.5", "0.5"];
}
export async function fetchTopMarkets(limit = 30) {
    try {
        const url = `${GAMMA}/markets?limit=${limit}&active=true&closed=false&order=volume&ascending=false`;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok)
            return seedMarkets();
        const arr = (await res.json());
        return (Array.isArray(arr) ? arr : []).map(parse).filter(Boolean);
    }
    catch {
        return seedMarkets();
    }
}
export async function fetchMarket(idOrQuery) {
    const all = await fetchTopMarkets(100);
    const q = idOrQuery.toLowerCase();
    return all.find((m) => m.id.toLowerCase() === q || m.question.toLowerCase().includes(q));
}
function parse(m) {
    const id = (m.conditionId ?? m.id ?? m.slug);
    if (!id)
        return null;
    const [yes, no] = parsePrices(m.outcomePrices ?? m.outcome_prices);
    const vol = String(m.volume24hr ?? m.volume24h ?? 0);
    const slug = m.slug ?? "";
    return {
        id: String(id),
        question: m.question ?? m.title ?? "",
        yesPrice: yes, noPrice: no,
        volume24h: vol,
        url: slug ? `https://polymarket.com/market/${slug}` : undefined,
    };
}
/** Offline fallback — bundled 5 markets. */
export function seedMarkets() {
    const s = seed;
    return s.markets;
}
