import { useEffect, useRef, useState } from "react";
import { useDB } from "../lib/useDB";
import { db } from "../lib/db";
import { D, asUSD, asOdds } from "../lib/money";
import { parse as parseCmd, parseStrict, ParsedTrade } from "../lib/parser";
import { askClaude, getClaudeKey, ClaudeMessage } from "../lib/claude";
import { Alert } from "../lib/types";
import { isRunning, start as startScheduler, stop as stopScheduler } from "../lib/scheduler";

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  pending?: ParsedTrade;
  alert?: Alert;
}

function alertLine(a: Alert): string {
  const emoji = a.kind === "opportunity" ? "💎"
             : a.kind === "take-profit"  ? "💰"
             : a.kind === "cut-loss"     ? "⚠️"
             : "📣";
  const sizing = a.sizeShares && a.sizeDollars
    ? `\n👉 ${a.action} ~${a.sizeShares} sh · $${a.sizeDollars}${a.sizeNote ? ` (${a.sizeNote})` : ""}`
    : "";
  return `${emoji} ${a.action} ${a.outcome} · ${a.marketName}\n` +
         `limit ${a.priceLimit} · ${a.confidence}% conf — ${a.rationale}${sizing}`;
}

const SYSTEM = `You are PolyBot — a helpful assistant for a LOCAL Polymarket simulator.
The user owns a simulated portfolio; you never claim to execute real trades.
When the user describes a trade, ask them to phrase it as "(sell) Market Outcome N"
or a plain sentence with shares + price + market. Keep replies under 240 chars.`;

export default function Chat() {
  const state = useDB();
  const [draft, setDraft] = useState("");
  const [cmdMode, setCmdMode] = useState(state.settings.commandMode);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Msg[]>([{
    id: "welcome", role: "assistant",
    text: "Hi! I'm PolyBot. Try `(sell) MarketX Yes 10` or a sentence like \"I bought 1 yes of POLY-BTC-100K at 0.42\". Nothing is recorded until you Confirm.",
  }]);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Start empty — first effect pass will seed with existing alerts so Felix
  // sees a recap of recent alerts when he opens Chat, plus live ones after.
  const lastAlertIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  // When new alerts arrive (or on mount, for recap), inject them as assistant
  // messages. Cap the initial recap to the most recent 12 so the chat doesn't
  // explode with hundreds of historic alerts.
  useEffect(() => {
    const isInitial = lastAlertIdsRef.current.size === 0;
    const candidates = isInitial ? state.alerts.slice(0, 12) : state.alerts;
    const fresh: Alert[] = [];
    for (const a of candidates) {
      if (!lastAlertIdsRef.current.has(a.id)) { fresh.push(a); lastAlertIdsRef.current.add(a.id); }
    }
    // Always mark ALL existing alerts as "seen" to prevent them re-injecting
    // later as new. (Only the top 12 get displayed this pass.)
    for (const a of state.alerts) lastAlertIdsRef.current.add(a.id);
    if (fresh.length === 0) return;
    const ordered = [...fresh].reverse();   // oldest first in chat flow
    setHistory((h) => [
      ...h,
      ...ordered.map((a) => ({
        id: `alert-${a.id}`,
        role: "assistant" as const,
        text: alertLine(a),
        alert: a,
      })),
    ]);
  }, [state.alerts]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
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
      const msgs: ClaudeMessage[] = history.slice(-8).map((m) => ({
        role: m.role, content: m.text,
      })).concat([{ role: "user", content: text }]);
      const reply = await askClaude(SYSTEM, msgs, { model: state.settings.claudeModel });
      setHistory((h) => [...h, {
        id: uid(), role: "assistant", text: reply.text || "(no reply)",
      }]);
    } catch (e: any) {
      setHistory((h) => [...h, {
        id: uid(), role: "assistant",
        text: "Claude error: " + (e.message ?? String(e)),
      }]);
    } finally {
      setBusy(false);
    }
  };

  const confirm = (trade: ParsedTrade) => {
    try {
      const price = trade.price ?? D("0.50");
      if (trade.side === "BUY") {
        db.recordBuy({
          marketId: trade.marketId, marketName: trade.marketId,
          outcome: trade.outcome, shares: trade.shares, price,
          date: trade.date,
        });
      } else {
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
    } catch (e: any) {
      setHistory((h) => [...h, {
        id: uid(), role: "assistant",
        text: "⚠️ " + (e.message ?? String(e)),
      }]);
    }
  };

  const running = isRunning();
  const latestAlert = state.alerts[0];

  return (
    <div className="flex flex-col h-full">
      {/* Alert engine strip — glass, no border, bg-shift only */}
      <div className="flex items-center gap-3 px-5 py-3 glass">
        <span className={`inline-block w-2 h-2 rounded-full ${
          running ? "bg-yes animate-pulse" : "bg-slate-600"
        }`}/>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-[0.15em] text-slate-500">
            {running ? "Engine running" : "Engine idle"}
          </div>
          <div className="text-[11px] text-slate-300 truncate">
            {running
              ? (latestAlert ? `${latestAlert.action} ${latestAlert.outcome} · ${latestAlert.marketName}` : "waiting for signal")
              : "alerts paused"}
          </div>
        </div>
        <button
          onClick={() => running ? stopScheduler() : startScheduler()}
          className={`text-[10px] px-3 py-2 rounded-lg font-bold uppercase tracking-wider ${
            running ? "bg-surface-hi text-slate-200" : "bg-signal text-white"
          }`}
        >{running ? "Pause" : "Resume"}</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {history.map((m) => (
          <Bubble key={m.id} msg={m} onConfirm={confirm} />
        ))}
        <div ref={bottomRef}/>
      </div>

      <div className="p-4 glass flex items-center gap-2">
        <button onClick={() => { setCmdMode(!cmdMode); db.setSettings({ commandMode: !cmdMode }); }}
          className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
            cmdMode ? "bg-signal text-white" : "bg-surface text-slate-400"
          }`}
          aria-label="Toggle command mode">CMD</button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder={cmdMode ? "(sell) Market Outcome N" : "Ask · record · parse"}
          className="flex-1 resize-none rounded-xl bg-surface px-3 py-3 text-sm placeholder:text-slate-500 focus:bg-surface-hi outline-none transition-colors"
        />
        <button onClick={send} disabled={busy || !draft.trim()}
          className="rounded-xl bg-gradient-to-br from-signal-lo to-signal text-white px-4 py-3 text-sm font-bold disabled:bg-surface-hi disabled:from-surface-hi disabled:to-surface-hi active:scale-95 transition-transform">
          Send
        </button>
      </div>
    </div>
  );
}

function Bubble({ msg, onConfirm }: { msg: Msg; onConfirm: (t: ParsedTrade) => void }) {
  const isUser = msg.role === "user";
  const isAlert = !!msg.alert;
  const bubble = isUser
    ? "bg-signal text-white"
    : isAlert
      ? "bg-surface-hi text-slate-100"
      : "bg-surface text-slate-100";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${bubble}`}>
        {isAlert && msg.alert && (
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-surface-top/40">
            <span className={`text-[9px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider ${
              msg.alert.action === "BUY" ? "bg-yes-bg text-yes" : "bg-no-bg text-no"
            }`}>{msg.alert.action} {msg.alert.outcome}</span>
            <span className="mono text-[10px] text-slate-400 ml-auto">{msg.alert.confidence}%</span>
          </div>
        )}
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.text}</div>
        {msg.alert?.url && (
          <a href={msg.alert.url} target="_blank" rel="noreferrer"
            className="mt-3 inline-block text-[11px] font-semibold text-signal-lo uppercase tracking-wider">
            Open on Polymarket ↗
          </a>
        )}
        {msg.pending && (
          <div className="mt-3">
            <button onClick={() => onConfirm(msg.pending!)}
              className={`w-full rounded-xl py-3 text-sm font-bold uppercase tracking-wider active:scale-95 transition-transform ${
                msg.pending.side === "BUY" ? "bg-yes-bg text-yes" : "bg-no-bg text-no"
              }`}>Confirm {msg.pending.side}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}
