import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { D, asOdds, asUSD } from "../lib/money";
import TransactionEntry from "./TransactionEntry";
export default function MarketDetail({ market, onBack }) {
    const [side, setSide] = useState("YES");
    const [qty, setQty] = useState("1");
    const [recording, setRecording] = useState(false);
    const price = side === "YES" ? D(market.yesPrice) : D(market.noPrice);
    const notional = D(qty || "0").mul(price).toDecimalPlaces(2);
    return (_jsxs("div", { className: "p-4 space-y-4", children: [_jsx("button", { onClick: onBack, className: "text-sm text-sky-400", children: "\u2190 Markets" }), _jsx("h1", { className: "text-lg font-semibold leading-snug", children: market.question }), _jsxs("div", { className: "flex gap-2 text-sm", children: [_jsxs("span", { className: "px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300", children: ["YES ", asOdds(market.yesPrice)] }), _jsxs("span", { className: "px-2 py-1 rounded-full bg-rose-500/15 text-rose-300", children: ["NO ", asOdds(market.noPrice)] }), market.url && (_jsx("a", { href: market.url, target: "_blank", rel: "noreferrer", className: "ml-auto text-sky-400 text-sm", children: "Open on Polymarket \u2197" }))] }), _jsxs("section", { className: "rounded-2xl bg-slate-900 p-3 space-y-2", children: [_jsx("h2", { className: "text-sm font-semibold", children: "Order simulator" }), _jsx("div", { className: "flex rounded-xl bg-slate-800 p-1", children: ["YES", "NO"].map((s) => (_jsx("button", { onClick: () => setSide(s), className: `flex-1 py-1.5 rounded-lg text-sm ${side === s ? "bg-sky-500 text-white" : "text-slate-300"}`, children: s }, s))) }), _jsxs("label", { className: "flex items-center gap-2 text-sm", children: [_jsx("span", { className: "w-16 text-slate-400", children: "Shares" }), _jsx("input", { inputMode: "decimal", value: qty, onChange: (e) => setQty(e.target.value), className: "flex-1 rounded-xl bg-slate-800 border border-slate-700 px-3 py-2" })] }), _jsxs("div", { className: "text-sm flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Price preview" }), _jsxs("span", { className: "tabular-nums", children: [asOdds(price), " \u2192 ", asUSD(notional)] })] }), _jsx("button", { onClick: () => setRecording(true), className: "w-full rounded-xl bg-sky-500 py-2 font-medium", children: "Record BUY (after you trade on Polymarket)" }), _jsx("p", { className: "text-xs text-amber-400", children: "This app is SIMULATION only. Execute the real trade on Polymarket yourself, then record it here." })] }), _jsxs("section", { className: "rounded-2xl bg-slate-900 p-3 space-y-1 text-sm", children: [_jsx("h2", { className: "font-semibold", children: "Mirror on real Polymarket" }), _jsxs("ol", { className: "list-decimal ml-5 text-slate-300 space-y-1", children: [_jsx("li", { children: "Open the market link above." }), _jsxs("li", { children: ["Execute ", side, " \u00D7 ", qty, " at the displayed price."] }), _jsxs("li", { children: ["Return here and tap ", _jsx("b", { children: "Record BUY" }), "."] })] })] }), recording && (_jsx(TransactionEntry, { onClose: () => setRecording(false), prefill: {
                    marketId: market.id,
                    marketName: market.question,
                    outcome: side,
                    side: "BUY",
                    shares: qty,
                    price: price.toFixed(4),
                } }))] }));
}
