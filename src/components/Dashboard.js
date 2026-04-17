import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useDB } from "../lib/useDB";
import { asUSD } from "../lib/money";
import Decimal from "decimal.js";
import TransactionEntry from "./TransactionEntry";
export default function Dashboard({ onOpenMarkets }) {
    const state = useDB();
    const [showEntry, setShowEntry] = useState(false);
    const [query, setQuery] = useState("");
    // Equity = cash + Σ(avgPrice * shares) — conservative MTM (avgPrice).
    // Portfolio view upgrades to live prices when online.
    const cash = new Decimal(state.settings.cashBalance);
    const value = state.positions.reduce((acc, p) => acc.plus(new Decimal(p.shares).mul(new Decimal(p.avgPrice))), new Decimal(0));
    const equity = cash.plus(value);
    const filtered = state.transactions.filter((t) => !query ||
        t.marketName.toLowerCase().includes(query.toLowerCase()) ||
        t.marketId.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
    return (_jsxs("div", { className: "p-4 space-y-4", children: [_jsxs("header", { children: [_jsx("h1", { className: "text-2xl font-bold", children: "PolyBot" }), _jsx("p", { className: "text-xs text-slate-400", children: "Local simulator \u00B7 manual entry only \u00B7 not financial advice" })] }), _jsxs("section", { className: "rounded-2xl bg-slate-900 p-4 shadow-lg", children: [_jsx("div", { className: "text-xs uppercase text-slate-400", children: "Cash balance" }), _jsx("div", { className: "text-4xl font-bold tabular-nums", children: asUSD(cash) }), _jsxs("div", { className: "mt-2 flex justify-between text-sm text-slate-400", children: [_jsxs("span", { children: ["Equity (MTM) ", _jsx("span", { className: "text-slate-200", children: asUSD(equity) })] }), _jsxs("span", { children: [state.positions.length, " positions"] })] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Search transactions\u2026", className: "flex-1 rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm" }), _jsx("button", { onClick: () => setShowEntry(true), className: "rounded-xl bg-sky-500 hover:bg-sky-400 px-4 py-2 text-sm font-medium", children: "+ Record" })] }), _jsxs("section", { children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("h2", { className: "font-semibold", children: "Recent transactions" }), _jsx("button", { onClick: onOpenMarkets, className: "text-xs text-sky-400", children: "Browse markets \u2192" })] }), filtered.length === 0 ? (_jsxs("div", { className: "text-slate-400 text-sm p-8 text-center border border-dashed border-slate-800 rounded-2xl", children: ["No transactions yet. Tap ", _jsx("b", { children: "+ Record" }), " to enter a trade you made on Polymarket."] })) : (_jsx("ul", { className: "divide-y divide-slate-800 rounded-2xl bg-slate-900", children: filtered.map((t) => (_jsxs("li", { className: "p-3 flex gap-3 items-center", children: [_jsx("span", { className: `text-lg ${t.side === "BUY" ? "text-emerald-400" : "text-rose-400"}`, children: t.side === "BUY" ? "↓" : "↑" }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "truncate text-sm", children: [t.side, " ", t.outcome, " \u00B7 ", t.marketName || t.marketId] }), _jsxs("div", { className: "text-[11px] text-slate-400", children: [parseFloat(t.shares).toFixed(2), " sh @ ", parseFloat(t.price).toFixed(2)] })] }), _jsx("div", { className: "tabular-nums text-sm", children: asUSD(t.notional) })] }, t.id))) }))] }), showEntry && _jsx(TransactionEntry, { onClose: () => setShowEntry(false) })] }));
}
