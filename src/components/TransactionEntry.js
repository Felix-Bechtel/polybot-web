import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { db } from "../lib/db";
import { D, asUSD, normalizePrice, parseUserDecimal } from "../lib/money";
export default function TransactionEntry({ onClose, prefill, }) {
    const [marketId, setMarketId] = useState(prefill?.marketId ?? "");
    const [marketName, setMarketName] = useState(prefill?.marketName ?? "");
    const [outcome, setOutcome] = useState(prefill?.outcome ?? "YES");
    const [side, setSide] = useState(prefill?.side ?? "BUY");
    const [sharesStr, setShares] = useState(prefill?.shares ?? "1");
    const [priceStr, setPriceStr] = useState(prefill?.price ?? "0.50");
    const [feesStr, setFees] = useState("0");
    const [notes, setNotes] = useState("");
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState(null);
    const shares = parseUserDecimal(sharesStr);
    const rawPrice = parseUserDecimal(priceStr);
    const price = rawPrice ? normalizePrice(rawPrice) : null;
    const fees = parseUserDecimal(feesStr) ?? D(0);
    const valid = !!shares && shares.greaterThan(0) && !!price
        && price.greaterThanOrEqualTo(0) && price.lessThanOrEqualTo(1)
        && marketId.trim().length > 0;
    const notional = valid ? shares.mul(price).plus(fees).toDecimalPlaces(2) : null;
    useEffect(() => setError(null), [marketId, sharesStr, priceStr, feesStr, side, outcome]);
    const save = () => {
        setError(null);
        if (!valid || !shares || !price)
            return;
        try {
            if (side === "BUY") {
                db.recordBuy({
                    marketId, marketName: marketName || marketId, outcome,
                    shares, price, fees,
                    notes: notes || undefined, date: new Date(date),
                });
            }
            else {
                db.recordSell({
                    marketId, outcome,
                    shares, price, fees,
                    notes: notes || undefined, date: new Date(date),
                });
            }
            onClose();
        }
        catch (e) {
            setError(e.message ?? String(e));
            setConfirming(false);
        }
    };
    return (_jsx("div", { className: "fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center", children: _jsxs("div", { className: "w-full sm:max-w-md bg-slate-900 rounded-t-3xl sm:rounded-3xl p-4 space-y-3 pb-safe", children: [_jsxs("header", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "text-lg font-semibold", children: "Record transaction" }), _jsx("button", { onClick: onClose, className: "text-slate-400 text-sm", children: "Cancel" })] }), _jsx(Field, { label: "Market id or slug", children: _jsx("input", { value: marketId, onChange: (e) => setMarketId(e.target.value), placeholder: "POLY-BTC-100K", className: inputCls }) }), _jsx(Field, { label: "Market name (optional)", children: _jsx("input", { value: marketName, onChange: (e) => setMarketName(e.target.value), placeholder: "Will BTC \u2026", className: inputCls }) }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsx(Field, { label: "Outcome", children: _jsx(Segmented, { value: outcome, onChange: (v) => setOutcome(v), options: ["YES", "NO"] }) }), _jsx(Field, { label: "Side", children: _jsx(Segmented, { value: side, onChange: (v) => setSide(v), options: ["BUY", "SELL"] }) })] }), _jsxs("div", { className: "grid grid-cols-3 gap-3", children: [_jsx(Field, { label: "Shares", children: _jsx("input", { inputMode: "decimal", value: sharesStr, onChange: (e) => setShares(e.target.value), className: inputCls }) }), _jsx(Field, { label: "Price", children: _jsx("input", { inputMode: "decimal", value: priceStr, onChange: (e) => setPriceStr(e.target.value), className: inputCls }) }), _jsx(Field, { label: "Fees", children: _jsx("input", { inputMode: "decimal", value: feesStr, onChange: (e) => setFees(e.target.value), className: inputCls }) })] }), _jsx(Field, { label: "Date", children: _jsx("input", { type: "datetime-local", value: date, onChange: (e) => setDate(e.target.value), className: inputCls }) }), _jsx(Field, { label: "Notes", children: _jsx("textarea", { value: notes, onChange: (e) => setNotes(e.target.value), rows: 2, className: inputCls }) }), notional && (_jsxs("div", { className: "text-sm text-slate-300 flex justify-between", children: [_jsx("span", { className: "text-slate-500", children: "Preview" }), _jsxs("span", { className: "tabular-nums", children: [side === "BUY" ? "DEBIT " : "CREDIT ", asUSD(notional)] })] })), error && _jsx("div", { className: "text-rose-400 text-sm", children: error }), !confirming ? (_jsx("button", { onClick: () => setConfirming(true), disabled: !valid, className: "w-full rounded-xl bg-sky-500 disabled:bg-slate-700 py-3 font-medium", children: "Review" })) : (_jsxs("div", { className: "space-y-2 border border-amber-500/40 bg-amber-950/30 rounded-xl p-3", children: [_jsxs("p", { className: "text-sm", children: [_jsx("b", { children: side }), " ", outcome, " \u00D7 ", sharesStr, " of ", _jsx("b", { children: marketName || marketId }), " at ", priceStr, ". Notional ", notional && asUSD(notional), ".", _jsx("br", {}), _jsx("span", { className: "text-amber-200 text-xs", children: "Only updates your LOCAL simulated portfolio. Execute the real trade on Polymarket yourself." })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: () => setConfirming(false), className: "flex-1 rounded-xl bg-slate-700 py-2", children: "Back" }), _jsx("button", { onClick: save, className: "flex-1 rounded-xl bg-emerald-500 py-2 font-medium", children: "Confirm" })] })] }))] }) }));
}
const inputCls = "w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-sm";
function Field({ label, children }) {
    return (_jsxs("label", { className: "block text-xs text-slate-400 space-y-1", children: [_jsx("span", { children: label }), children] }));
}
function Segmented({ value, onChange, options }) {
    return (_jsx("div", { className: "flex rounded-xl bg-slate-800 p-1", children: options.map((o) => (_jsx("button", { onClick: () => onChange(o), className: `flex-1 rounded-lg py-1.5 text-sm ${value === o ? "bg-sky-500 text-white" : "text-slate-300"}`, children: o }, o))) }));
}
