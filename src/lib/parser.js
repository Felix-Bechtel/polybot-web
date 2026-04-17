// CommandParser — strict "(sell)/(buy)" + natural language.
// Returns `null` on failure so the caller can route the text to Claude.
import { D, normalizePrice } from "./money";
const STRICT = /^\s*\((?<v>buy|sell)\)\s+(?<m>[^\s]+(?:\s+[^\s]+)*?)\s+(?<o>yes|no)\s+(?<q>\d+(?:\.\d+)?)(?:\s+(?:at|@)\s*\$?(?<p>\d+(?:\.\d+)?))?\s*$/i;
const NATURAL = [
    /\b(?:i\s+)?(?<v>bought|sold|buy|sell)\s+(?<q>\d+(?:\.\d+)?)\s+(?:shares?\s+)?(?<o>yes|no)\s+(?:of\s+|in\s+|on\s+)?(?<m>[A-Za-z0-9_\-]+(?:\s+[A-Za-z0-9_\-]+){0,5}?)\s+(?:at|@|for)\s*\$?(?<p>\d+(?:\.\d+)?|market)\b/i,
    /\b(?<v>bought|sold|buy|sell)\s+(?<q>\d+(?:\.\d+)?)\s+shares?\s+of\s+(?<m>[^@]+?)(?:\s+(?:at|@))\s*\$?(?<p>\d+(?:\.\d+)?)/i,
];
const DATE_RX = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4})\b/;
function buildTrade(m) {
    const g = m.groups ?? {};
    const verb = (g.v ?? "").toLowerCase();
    const side = verb.startsWith("s") ? "SELL" : "BUY";
    const marketId = (g.m ?? "").trim();
    if (!marketId)
        return null;
    const outcome = (g.o ?? "yes").toUpperCase();
    let shares;
    try {
        shares = D(g.q ?? "0");
    }
    catch {
        return null;
    }
    if (!shares.greaterThan(0))
        return null;
    let price = null;
    if (g.p && g.p.toLowerCase() !== "market") {
        try {
            price = normalizePrice(D(g.p));
        }
        catch {
            return null;
        }
    }
    return { side, marketId, outcome, shares, price };
}
function extractDate(text) {
    const m = text.match(DATE_RX);
    if (!m)
        return undefined;
    const raw = m[1];
    const d = new Date(raw);
    return isNaN(d.getTime()) ? undefined : d;
}
export function parseStrict(text) {
    const m = text.match(STRICT);
    return m ? buildTrade(m) : null;
}
export function parseNatural(text) {
    for (const rx of NATURAL) {
        const m = text.match(rx);
        if (m) {
            const t = buildTrade(m);
            if (t) {
                const d = extractDate(text);
                if (d)
                    t.date = d;
                return t;
            }
        }
    }
    return null;
}
export function parse(text) {
    return parseStrict(text) ?? parseNatural(text);
}
