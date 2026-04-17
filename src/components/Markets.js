import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { fetchTopMarkets } from "../lib/polymarket";
import { asOdds, asUSD } from "../lib/money";
import MarketDetail from "./MarketDetail";
export default function Markets() {
    const [markets, setMarkets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState(null);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const data = await fetchTopMarkets();
            if (!cancelled) {
                setMarkets(data);
                setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);
    const filtered = useMemo(() => {
        if (!query)
            return markets;
        const q = query.toLowerCase();
        return markets.filter((m) => m.id.toLowerCase().includes(q) || m.question.toLowerCase().includes(q));
    }, [markets, query]);
    if (selected)
        return _jsx(MarketDetail, { market: selected, onBack: () => setSelected(null) });
    return (_jsxs("div", { className: "p-4 space-y-3", children: [_jsx("h1", { className: "text-xl font-semibold", children: "Markets" }), _jsx("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Search markets\u2026", className: "w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm" }), loading && _jsx("div", { className: "text-slate-400 text-sm", children: "Loading\u2026" }), _jsx("ul", { className: "space-y-2", children: filtered.map((m) => (_jsx("li", { children: _jsxs("button", { onClick: () => setSelected(m), className: "w-full text-left rounded-2xl bg-slate-900 p-3 active:bg-slate-800", children: [_jsx("div", { className: "text-sm line-clamp-2", children: m.question }), _jsxs("div", { className: "mt-2 flex items-center gap-2 text-xs", children: [_jsxs(Pill, { tint: "emerald", children: ["YES ", asOdds(m.yesPrice)] }), _jsxs(Pill, { tint: "rose", children: ["NO ", asOdds(m.noPrice)] }), _jsxs("span", { className: "ml-auto text-slate-500", children: ["vol ", asUSD(m.volume24h)] })] })] }) }, m.id))) })] }));
}
function Pill({ children, tint }) {
    const bg = tint === "emerald" ? "bg-emerald-500/15 text-emerald-300"
        : "bg-rose-500/15 text-rose-300";
    return _jsx("span", { className: `px-2 py-0.5 rounded-full ${bg} tabular-nums`, children: children });
}
