import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { useDB } from "../lib/useDB";
import { db } from "../lib/db";
import { D, asUSD, asOdds } from "../lib/money";
import { parse as parseCmd, parseStrict } from "../lib/parser";
import { askClaude, getClaudeKey } from "../lib/claude";
const SYSTEM = `You are PolyBot — a helpful assistant for a LOCAL Polymarket simulator.
The user owns a simulated portfolio; you never claim to execute real trades.
When the user describes a trade, ask them to phrase it as "(sell) Market Outcome N"
or a plain sentence with shares + price + market. Keep replies under 240 chars.`;
export default function Chat() {
    const state = useDB();
    const [draft, setDraft] = useState("");
    const [cmdMode, setCmdMode] = useState(state.settings.commandMode);
    const [busy, setBusy] = useState(false);
    const [history, setHistory] = useState([{
            id: "welcome", role: "assistant",
            text: "Hi! I'm PolyBot. Try `(sell) MarketX Yes 10` or a sentence like \"I bought 1 yes of POLY-BTC-100K at 0.42\". Nothing is recorded until you Confirm.",
        }]);
    const bottomRef = useRef(null);
    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);
    const send = async () => {
        const text = draft.trim();
        if (!text)
            return;
        setDraft("");
        setHistory((h) => [...h, { id: uid(), role: "user", text }]);
        // 1) Local parse first — free, offline, instant.
        const parsed = cmdMode ? parseStrict(text) : parseCmd(text);
        if (parsed) {
            const price = parsed.price ?? D("0.50");
            const proceeds = parsed.shares.mul(price).toDecimalPlaces(2);
            const verb = parsed.side === "BUY" ? "Buy" : "Sell";
            const flow = parsed.side === "BUY" ? "cost" : "proceeds";
            setHistory((h) => [...h, {
                    id: uid(), role: "assistant",
                    text: `${verb} ${asOdds(parsed.shares)} shares of '${parsed.outcome}' in ${parsed.marketId} at ${asOdds(price)} → ${flow} ${asUSD(proceeds)}. Confirm to record.`,
                    pending: parsed,
                }]);
            return;
        }
        // 2) Otherwise escalate to Claude (if key present).
        if (!getClaudeKey()) {
            setHistory((h) => [...h, {
                    id: uid(), role: "assistant",
                    text: "I can parse trades locally (try `(sell) Market Yes 10`), or add your Claude API key in Settings for free-form chat.",
                }]);
            return;
        }
        setBusy(true);
        try {
            const msgs = history.slice(-8).map((m) => ({
                role: m.role, content: m.text,
            })).concat([{ role: "user", content: text }]);
            const reply = await askClaude(SYSTEM, msgs, { model: state.settings.claudeModel });
            setHistory((h) => [...h, {
                    id: uid(), role: "assistant", text: reply.text || "(no reply)",
                }]);
        }
        catch (e) {
            setHistory((h) => [...h, {
                    id: uid(), role: "assistant",
                    text: "Claude error: " + (e.message ?? String(e)),
                }]);
        }
        finally {
            setBusy(false);
        }
    };
    const confirm = (trade) => {
        try {
            const price = trade.price ?? D("0.50");
            if (trade.side === "BUY") {
                db.recordBuy({
                    marketId: trade.marketId, marketName: trade.marketId,
                    outcome: trade.outcome, shares: trade.shares, price,
                    date: trade.date,
                });
            }
            else {
                db.recordSell({
                    marketId: trade.marketId, outcome: trade.outcome,
                    shares: trade.shares, price, date: trade.date,
                });
            }
            const cash = db.load().settings.cashBalance;
            setHistory((h) => [...h, {
                    id: uid(), role: "assistant",
                    text: `✅ Recorded. New cash balance: ${asUSD(cash)}.`,
                }]);
        }
        catch (e) {
            setHistory((h) => [...h, {
                    id: uid(), role: "assistant",
                    text: "⚠️ " + (e.message ?? String(e)),
                }]);
        }
    };
    return (_jsxs("div", { className: "flex flex-col h-full", children: [_jsxs("div", { className: "flex-1 overflow-y-auto p-4 space-y-3", children: [history.map((m) => (_jsx(Bubble, { msg: m, onConfirm: confirm }, m.id))), _jsx("div", { ref: bottomRef })] }), _jsxs("div", { className: "p-3 border-t border-slate-800 flex items-center gap-2", children: [_jsx("button", { onClick: () => { setCmdMode(!cmdMode); db.setSettings({ commandMode: !cmdMode }); }, className: `px-2 py-1 rounded-lg text-xs ${cmdMode ? "bg-sky-500" : "bg-slate-800"}`, "aria-label": "Toggle command mode", children: "CMD" }), _jsx("textarea", { value: draft, onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            send();
                        } }, rows: 1, placeholder: cmdMode ? "(sell) Market Outcome N" : "Say something… or record a trade", className: "flex-1 resize-none rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm" }), _jsx("button", { onClick: send, disabled: busy || !draft.trim(), className: "rounded-xl bg-sky-500 px-3 py-2 text-sm font-medium disabled:bg-slate-700", children: "Send" })] })] }));
}
function Bubble({ msg, onConfirm }) {
    const isUser = msg.role === "user";
    return (_jsx("div", { className: `flex ${isUser ? "justify-end" : "justify-start"}`, children: _jsxs("div", { className: `max-w-[85%] rounded-2xl px-3 py-2 ${isUser ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-100"}`, children: [_jsx("div", { className: "text-sm whitespace-pre-wrap", children: msg.text }), msg.pending && (_jsx("div", { className: "mt-2 flex gap-2", children: _jsx("button", { onClick: () => onConfirm(msg.pending), className: `flex-1 rounded-lg py-1 text-sm font-medium ${msg.pending.side === "BUY" ? "bg-emerald-500" : "bg-rose-500"} text-white`, children: "Confirm" }) }))] }) }));
}
function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}
