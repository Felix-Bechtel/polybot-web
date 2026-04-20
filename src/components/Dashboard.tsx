import { useEffect, useState } from "react";
import { useDB } from "../lib/useDB";
import { asUSD } from "../lib/money";
import Decimal from "decimal.js";
import TransactionEntry from "./TransactionEntry";
import {
  start as startScheduler, stop as stopScheduler,
  isRunning, checkNow, getStatus, onSchedulerChange,
} from "../lib/scheduler";
import { normalizePolymarketUrl } from "../lib/polymarket";
import { fetchLiveBalance, LiveBalance } from "../lib/webpush";

function fmtRel(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

export default function Dashboard({ onOpenMarkets }: { onOpenMarkets: () => void }) {
  const state = useDB();
  const [showEntry, setShowEntry] = useState(false);
  const [query, setQuery] = useState("");
  const [, forceRender] = useState(0);
  const [liveBalance, setLiveBalance] = useState<LiveBalance | null>(null);

  // Pull live Polymarket balance from the Worker when a wallet is linked.
  const polyAddr = state.settings.polymarketAddress;
  useEffect(() => {
    if (!polyAddr) { setLiveBalance(null); return; }
    let cancelled = false;
    const load = async () => {
      const b = await fetchLiveBalance(polyAddr);
      if (!cancelled) setLiveBalance(b);
    };
    void load();
    const h = setInterval(() => { void load(); }, 60_000);
    return () => { cancelled = true; clearInterval(h); };
  }, [polyAddr]);

  useEffect(() => onSchedulerChange(() => forceRender((n) => n + 1)), []);
  useEffect(() => {
    const t = setInterval(() => forceRender((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const cash = new Decimal(state.settings.cashBalance);
  const value = state.positions.reduce((acc, p) =>
    acc.plus(new Decimal(p.shares).mul(new Decimal(p.avgPrice))),
    new Decimal(0));
  const equity = cash.plus(value);

  const filtered = state.transactions.filter((t) =>
    !query ||
    t.marketName.toLowerCase().includes(query.toLowerCase()) ||
    t.marketId.toLowerCase().includes(query.toLowerCase()),
  ).slice(0, 12);

  const running = isRunning();
  const recentAlerts = state.alerts.slice(0, 8);

  return (
    <div className="p-5 space-y-5">
      {/* Brand header — Stitch spec: logo + Poly(signal)Bot(white) */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}apple-touch-icon.png`} alt="PolyBot"
            className="w-10 h-10 rounded-xl shadow-ambient"/>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight leading-none">
              <span className="text-signal">Poly</span>Bot
            </h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-[0.12em] mt-1">
              Tiny bets · real signal
            </p>
          </div>
        </div>
        <button
          onClick={onOpenMarkets}
          className="relative text-slate-400 w-10 h-10 rounded-xl bg-surface flex items-center justify-center"
          aria-label="Go to markets"
        >
          <span className="text-lg">🔔</span>
          {recentAlerts.length > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-no rounded-full border-2 border-canvas"/>
          )}
        </button>
      </header>

      {/* Cash balance — editorial block, mono figures */}
      <section className="rounded-2xl bg-surface p-5 shadow-ambient">
        <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Cash balance</div>
        <div className="mono text-4xl font-bold mt-1 tracking-tight">{asUSD(cash)}</div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Equity MTM</div>
            <div className="mono text-lg font-semibold text-slate-200">{asUSD(equity)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Positions</div>
            <div className="mono text-lg font-semibold text-slate-200">{state.positions.length}</div>
          </div>
        </div>
      </section>

      {/* Live Polymarket balance — visible only when wallet is linked */}
      {polyAddr && (
        <section className="rounded-2xl bg-surface p-5 shadow-ambient">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500">
              🟢 Polymarket balance (live)
            </div>
            {liveBalance?.updatedAt && (
              <div className="mono text-[10px] text-slate-500">
                {fmtRel(new Date(liveBalance.updatedAt).toISOString())}
              </div>
            )}
          </div>
          <div className="mono text-3xl font-bold mt-1 tabular-nums">
            {liveBalance?.value != null
              ? `$${liveBalance.value.toFixed(2)}`
              : <span className="text-slate-500 text-lg">—</span>}
          </div>
          {liveBalance && liveBalance.positions.length > 0 && (
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Positions</div>
                <div className="mono text-lg font-semibold">{liveBalance.positions.length}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Total P&L</div>
                <div className={`mono text-lg font-semibold ${
                  liveBalance.positions.reduce((s, p) => s + p.cashPnl, 0) >= 0 ? "text-yes" : "text-no"
                }`}>
                  {(() => {
                    const pnl = liveBalance.positions.reduce((s, p) => s + p.cashPnl, 0);
                    return `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
                  })()}
                </div>
              </div>
            </div>
          )}
          <p className="text-[10px] text-slate-500 mt-3">
            Polled every 10 min · backend tracks changes · alerts pushed to your phone
          </p>
        </section>
      )}

      {/* Alerts control — glass-gradient CTA vibe */}
      <section className="rounded-2xl bg-surface p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500">
              Alert engine
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-block w-2 h-2 rounded-full ${
                running ? "bg-yes animate-pulse" : "bg-slate-600"
              }`}/>
              <span className="text-base font-semibold">
                {running ? "Running" : "Idle"}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1 truncate mono">
              every {Math.round(state.settings.alertIntervalMs / 60000)}m · last {fmtRel(state.settings.lastCheckedAt)} · {getStatus()}
            </div>
          </div>
          <button
            onClick={() => (running ? stopScheduler() : startScheduler())}
            className={`shrink-0 px-5 py-3 rounded-xl text-sm font-bold tracking-wide transition-transform active:scale-95 ${
              running
                ? "bg-surface-hi text-slate-100"
                : "bg-gradient-to-br from-signal-lo to-signal text-white shadow-lg shadow-signal/20"
            }`}
          >
            {running ? "STOP" : "START"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => void checkNow()}
            className="rounded-xl bg-surface-hi py-3 text-xs font-semibold uppercase tracking-wider text-slate-200 active:bg-surface-top"
          >Check now</button>
          <button
            onClick={onOpenMarkets}
            className="rounded-xl bg-surface-hi py-3 text-xs font-semibold uppercase tracking-wider text-slate-200 active:bg-surface-top"
          >Browse →</button>
        </div>
        {state.settings.watchlist.length === 0 && (
          <p className="text-[11px] text-warn">
            Watchlist empty — add keywords in Settings for alerts to fire.
          </p>
        )}
      </section>

      {/* Recent alerts — asymmetric editorial layout */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Opportunities</h2>
          {state.alerts.length > 0 && (
            <span className="mono text-[11px] text-slate-500">{state.alerts.length} tracked</span>
          )}
        </div>
        {recentAlerts.length === 0 ? (
          <div className="text-slate-500 text-sm p-6 text-center rounded-2xl bg-surface">
            No opportunities yet. Start the engine and they'll appear here.
          </div>
        ) : (
          <ul className="space-y-3">
            {recentAlerts.map((a) => {
              const isBuy = a.action === "BUY";
              return (
                <li key={a.id}>
                  <a href={normalizePolymarketUrl(a.url) ?? "#"} target="_blank" rel="noreferrer"
                    className="block rounded-2xl bg-surface p-4 active:bg-surface-hi">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[9px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider ${
                            isBuy
                              ? "bg-yes-bg text-yes"
                              : "bg-no-bg text-no"
                          }`}>{a.action} {a.outcome}</span>
                          <span className="text-[9px] uppercase tracking-wider text-slate-500">
                            {a.kind.replace("-", " ")}
                          </span>
                        </div>
                        <div className="text-[15px] font-semibold leading-snug line-clamp-2">
                          {a.marketName}
                        </div>
                        {a.sizeShares && a.sizeDollars && (
                          <div className="mt-2 mono text-sm text-signal-lo">
                            ~{a.sizeShares} sh · ${a.sizeDollars}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="mono text-xs text-slate-400">{fmtRel(a.createdAt)}</div>
                        <div className="mono text-lg font-bold mt-2">{a.confidence}<span className="text-slate-500 text-sm">%</span></div>
                        <div className="text-[9px] uppercase tracking-wider text-slate-500">conf</div>
                      </div>
                    </div>
                    <div className="mt-3 text-[11px] text-slate-500 line-clamp-2">{a.rationale}</div>
                    <div className="mt-2 mono text-[10px] text-slate-500">
                      limit {a.priceLimit}{a.sizeNote ? ` · ${a.sizeNote}` : ""}
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Transactions search + record */}
      <section className="space-y-3">
        <div className="flex gap-2">
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transactions…"
            className="flex-1 rounded-xl bg-surface px-4 py-3 text-sm placeholder:text-slate-500 focus:bg-surface-hi outline-none transition-colors"
          />
          <button
            onClick={() => setShowEntry(true)}
            className="rounded-xl bg-gradient-to-br from-signal-lo to-signal text-white px-5 py-3 text-sm font-bold active:scale-95 transition-transform"
          >+ REC</button>
        </div>
      </section>

      {/* Recent transactions */}
      <section className="space-y-2">
        <h2 className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Recent transactions</h2>
        {filtered.length === 0 ? (
          <div className="text-slate-500 text-sm p-6 text-center rounded-2xl bg-surface">
            No transactions yet.
          </div>
        ) : (
          <ul className="rounded-2xl bg-surface divide-y divide-surface-hi">
            {filtered.map((t) => (
              <li key={t.id} className="p-4 flex gap-3 items-center">
                <span className={`text-base font-bold ${t.side === "BUY" ? "text-yes" : "text-no"}`}>
                  {t.side === "BUY" ? "↓" : "↑"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{t.side} {t.outcome} · {t.marketName || t.marketId}</div>
                  <div className="mono text-[11px] text-slate-500">{parseFloat(t.shares).toFixed(2)} sh @ {parseFloat(t.price).toFixed(2)}</div>
                </div>
                <div className="mono text-sm font-semibold">{asUSD(t.notional)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-[10px] text-slate-600 pt-2 tracking-wide">
        Local simulator · manual entry only · not financial advice
      </p>

      {showEntry && <TransactionEntry onClose={() => setShowEntry(false)} />}
    </div>
  );
}
