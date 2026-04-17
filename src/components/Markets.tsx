import { useEffect, useMemo, useState } from "react";
import { Market } from "../lib/types";
import { fetchTopMarkets } from "../lib/polymarket";
import { asOdds, asUSD } from "../lib/money";
import MarketDetail from "./MarketDetail";

export default function Markets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Market | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await fetchTopMarkets();
      if (!cancelled) { setMarkets(data); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!query) return markets;
    const q = query.toLowerCase();
    return markets.filter((m) =>
      m.id.toLowerCase().includes(q) || m.question.toLowerCase().includes(q),
    );
  }, [markets, query]);

  if (selected) return <MarketDetail market={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-semibold">Markets</h1>
      <input
        value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Search markets…"
        className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm"
      />
      {loading && <div className="text-slate-400 text-sm">Loading…</div>}
      <ul className="space-y-2">
        {filtered.map((m) => (
          <li key={m.id}>
            <button onClick={() => setSelected(m)}
              className="w-full text-left rounded-2xl bg-slate-900 p-3 active:bg-slate-800">
              <div className="text-sm line-clamp-2">{m.question}</div>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <Pill tint="emerald">YES {asOdds(m.yesPrice)}</Pill>
                <Pill tint="rose">NO {asOdds(m.noPrice)}</Pill>
                <span className="ml-auto text-slate-500">vol {asUSD(m.volume24h)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pill({ children, tint }: { children: React.ReactNode; tint: "emerald" | "rose" }) {
  const bg = tint === "emerald" ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-rose-500/15 text-rose-300";
  return <span className={`px-2 py-0.5 rounded-full ${bg} tabular-nums`}>{children}</span>;
}
