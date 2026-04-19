import { useEffect, useMemo, useState } from "react";
import { Market } from "../lib/types";
import {
  fetchOpportunities, fetchCategoryMarkets, searchMarkets,
  suggestPosition, PositionSuggestion,
} from "../lib/polymarket";
import { CATEGORIES } from "../lib/categories";
import { asOdds, asUSD } from "../lib/money";
import { suggestSize } from "../lib/sizer";
import { useDB } from "../lib/useDB";
import MarketDetail from "./MarketDetail";

type Mode =
  | { kind: "search" }
  | { kind: "opps" }
  | { kind: "category"; id: string; label: string; terms: string[] };

const CATEGORY_TABS: Mode[] = [
  { kind: "category", id: "politics-us", label: "Politics",
    terms: CATEGORIES.find((c) => c.id === "politics-us")!.terms },
  { kind: "category", id: "geopolitics", label: "Geo",
    terms: CATEGORIES.find((c) => c.id === "geopolitics")!.terms },
  { kind: "category", id: "tech", label: "Tech",
    terms: CATEGORIES.find((c) => c.id === "tech")!.terms },
];
const TABS: Mode[] = [{ kind: "search" }, { kind: "opps" }, ...CATEGORY_TABS];

const REFRESH_MS = 30_000;
const PER_TAB_LIMIT = 25;

export default function Markets() {
  const state = useDB();
  const [mode, setMode] = useState<Mode>({ kind: "search" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshingAt, setRefreshingAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<Market | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    if (mode.kind !== "search") return;
    const q = query.trim();
    if (!q) { setResults([]); setLatency(null); return; }
    setLoading(true);
    const t0 = performance.now();
    const handle = setTimeout(async () => {
      const data = await searchMarkets(q, 60);
      setResults(data);
      setLatency(Math.round(performance.now() - t0));
      setLoading(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [query, mode]);

  useEffect(() => {
    if (mode.kind === "search") return;
    let cancelled = false;
    const load = async () => {
      const t0 = performance.now();
      setLoading(results.length === 0);
      setRefreshingAt(Date.now());
      const data = mode.kind === "opps"
        ? await fetchOpportunities(PER_TAB_LIMIT)
        : await fetchCategoryMarkets(mode.terms, PER_TAB_LIMIT);
      if (cancelled) return;
      setResults(data);
      setLatency(Math.round(performance.now() - t0));
      setLoading(false);
    };
    void load();
    const h = setInterval(() => { void load(); }, REFRESH_MS);
    return () => { cancelled = true; clearInterval(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => { setResults([]); setLatency(null); }, [mode.kind, tabId(mode)]);

  if (selected) return <MarketDetail market={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="p-5 space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Markets</h1>
        <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mt-1">
          Live Polymarket · no Claude tokens used
          {mode.kind !== "search" && refreshingAt && (
            <> · refresh {REFRESH_MS / 1000}s</>
          )}
        </p>
      </header>

      {/* Tab strip — filter chips per Stitch: surface-container-highest when active = signal */}
      <div className="flex gap-2 text-xs overflow-x-auto no-scrollbar -mx-5 px-5">
        {TABS.map((t) => {
          const active = tabId(mode) === tabId(t);
          return (
            <button key={tabId(t)}
              onClick={() => setMode(t)}
              className={`shrink-0 px-4 py-2 rounded-xl whitespace-nowrap font-semibold tracking-wide transition-colors ${
                active
                  ? "bg-signal text-white"
                  : "bg-surface text-slate-400 active:bg-surface-hi"
              }`}
            >{tabLabel(t)}</button>
          );
        })}
      </div>

      {mode.kind === "search" && (
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Polymarket — BTC, election, Fed…"
            autoFocus
            className="w-full rounded-xl bg-surface px-4 py-4 text-sm placeholder:text-slate-500 focus:bg-surface-hi outline-none transition-colors"
          />
          {loading && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-500 animate-pulse uppercase tracking-wider">
              searching
            </span>
          )}
        </div>
      )}

      {mode.kind === "search" && !query.trim() ? (
        <div className="text-slate-500 text-sm p-10 text-center rounded-2xl bg-surface">
          <div className="text-3xl mb-2">🔎</div>
          Type anything to query Polymarket.<br/>
          No default list · no limits.
        </div>
      ) : !loading && results.length === 0 ? (
        <div className="text-slate-500 text-sm p-8 text-center rounded-2xl bg-surface">
          {mode.kind === "search"
            ? <>No markets match <b className="text-slate-300">"{query}"</b>.</>
            : "Refreshing…"}
        </div>
      ) : (
        <>
          {latency !== null && (
            <div className="mono text-[10px] text-slate-500 flex items-center gap-2 uppercase tracking-wider">
              <span>{results.length} result{results.length !== 1 ? "s" : ""} · {latency}ms</span>
              {mode.kind !== "search" && refreshingAt && (
                <span className="ml-auto">upd {fmtAgo(refreshingAt)}</span>
              )}
            </div>
          )}
          <ul className="space-y-3">
            {results.map((m) => (
              <Row key={m.id} m={m} cashBalance={state.settings.cashBalance}
                   onSelect={() => setSelected(m)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Row({ m, cashBalance, onSelect }: {
  m: Market; cashBalance: string; onSelect: () => void;
}) {
  const rec = useMemo<PositionSuggestion>(() => suggestPosition(m), [m]);
  const sizing = useMemo(() => {
    if (rec.side === "HOLD") return null;
    const price = rec.side === "YES" ? m.yesPrice : m.noPrice;
    return suggestSize({
      action: "BUY",
      priceLimit: price,
      confidence: rec.confidence,
      cashBalance,
    });
  }, [rec, m, cashBalance]);

  return (
    <li>
      <button
        onClick={onSelect}
        className="w-full text-left rounded-2xl bg-surface p-4 active:bg-surface-hi transition-colors"
      >
        {/* Asymmetric: title top, price-per-share top-right label, data bottom */}
        <div className="flex items-start justify-between gap-3">
          <div className="text-[15px] font-semibold leading-snug line-clamp-2 flex-1">
            {m.question}
          </div>
          <div className="text-right shrink-0">
            <div className="text-[9px] uppercase tracking-wider text-slate-500">Vol 24h</div>
            <div className="mono text-xs text-slate-300">{asUSD(m.volume24h)}</div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="flex items-baseline gap-1 px-2.5 py-1 rounded-lg bg-yes-bg">
            <span className="text-[9px] uppercase tracking-wider text-yes">Yes</span>
            <span className="mono text-xs text-yes font-semibold">{asOdds(m.yesPrice)}</span>
          </span>
          <span className="flex items-baseline gap-1 px-2.5 py-1 rounded-lg bg-no-bg">
            <span className="text-[9px] uppercase tracking-wider text-no">No</span>
            <span className="mono text-xs text-no font-semibold">{asOdds(m.noPrice)}</span>
          </span>
          <span className={`ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg ${
            rec.side === "YES" ? "bg-yes-bg text-yes" :
            rec.side === "NO"  ? "bg-no-bg text-no" :
            "bg-surface-hi text-slate-400"
          }`}>
            {rec.side === "HOLD" ? "Hold" : `Buy ${rec.side}`} · <span className="mono">{rec.confidence}%</span>
          </span>
        </div>

        {sizing && parseFloat(sizing.dollars) > 0 && (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-surface-hi px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-slate-500">Suggested size</div>
            <div className="mono text-sm text-signal-lo font-semibold">
              ~{sizing.shares} sh · ${sizing.dollars}
            </div>
          </div>
        )}
        <div className="mt-2 text-[11px] text-slate-500 leading-snug">{rec.reason}</div>
      </button>
    </li>
  );
}

function tabId(m: Mode): string { return m.kind === "category" ? `cat:${m.id}` : m.kind; }
function tabLabel(m: Mode): string {
  if (m.kind === "search") return "Search";
  if (m.kind === "opps") return "Opportunities";
  return m.label === "Politics" ? "Politics"
       : m.label === "Geo"      ? "Geopolitics"
       : m.label === "Tech"     ? "Tech"
       : m.label;
}

function fmtAgo(ms: number): string {
  const d = Math.round((Date.now() - ms) / 1000);
  if (d < 60) return `${d}s`;
  return `${Math.round(d / 60)}m`;
}
