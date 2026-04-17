import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useDB } from "../lib/useDB";
import { fetchMarket } from "../lib/polymarket";
import { D, asOdds, asUSD } from "../lib/money";
import TransactionEntry from "./TransactionEntry";
export default function Portfolio() {
    const state = useDB();
    const [live, setLive] = useState({});
    const [active, setActive] = useState(null);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const ids = Array.from(new Set(state.positions.map((p) => p.marketId)));
            const out = {};
            for (const id of ids) {
                const m = await fetchMarket(id);
                if (m)
                    out[id] = { yes: m.yesPrice, no: m.noPrice };
            }
            if (!cancelled)
                setLive(out);
        })();
        return () => { cancelled = true; };
    }, [state.positions.length]);
    const positions = state.positions;
    return (_jsxs("div", { className: "p-4 space-y-3", children: [_jsx("h1", { className: "text-xl font-semibold", children: "Portfolio" }), positions.length === 0 ? (_jsx("div", { className: "text-slate-400 text-sm p-8 text-center border border-dashed border-slate-800 rounded-2xl", children: "No open positions. Record a BUY from Markets or Chat." })) : (_jsx("ul", { className: "space-y-2", children: positions.map((p) => {
                    const cur = live[p.marketId];
                    const curPrice = cur ? (p.outcome === "YES" ? cur.yes : cur.no) : p.avgPrice;
                    const pnl = D(curPrice).minus(D(p.avgPrice)).mul(D(p.shares));
                    return (_jsxs("li", { className: "rounded-2xl bg-slate-900 p-3 space-y-2", children: [_jsx("div", { className: "text-sm line-clamp-1", children: p.marketName || p.marketId }), _jsxs("div", { className: "flex flex-wrap gap-2 text-xs text-slate-400", children: [_jsxs("span", { children: [p.outcome, " \u00D7 ", parseFloat(p.shares).toFixed(2)] }), _jsxs("span", { children: ["avg ", asOdds(p.avgPrice), " \u00B7 now ", asOdds(curPrice)] }), _jsx("span", { className: `ml-auto tabular-nums ${pnl.isNegative() ? "text-rose-400" : "text-emerald-400"}`, children: asUSD(pnl) })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: () => setActive({ position: p, side: "BUY" }), className: "flex-1 rounded-xl bg-slate-800 py-1.5 text-sm", children: "Buy more" }), _jsx("button", { onClick: () => setActive({ position: p, side: "SELL" }), className: "flex-1 rounded-xl bg-sky-500 py-1.5 text-sm font-medium", children: "Sell" })] })] }, p.id));
                }) })), active && (_jsx(TransactionEntry, { onClose: () => setActive(null), prefill: {
                    marketId: active.position.marketId,
                    marketName: active.position.marketName,
                    outcome: active.position.outcome,
                    side: active.side,
                    shares: active.position.shares,
                    price: live[active.position.marketId]
                        ? (active.position.outcome === "YES" ? live[active.position.marketId].yes : live[active.position.marketId].no)
                        : active.position.avgPrice,
                } }))] }));
}
