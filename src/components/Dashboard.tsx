import { useState } from "react";
import { useDB } from "../lib/useDB";
import { asUSD } from "../lib/money";
import Decimal from "decimal.js";
import TransactionEntry from "./TransactionEntry";

export default function Dashboard({ onOpenMarkets }: { onOpenMarkets: () => void }) {
  const state = useDB();
  const [showEntry, setShowEntry] = useState(false);
  const [query, setQuery] = useState("");

  // Equity = cash + Σ(avgPrice * shares) — conservative MTM (avgPrice).
  // Portfolio view upgrades to live prices when online.
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

  return (
    <div className="p-4 space-y-4">
      <header>
        <h1 className="text-2xl font-bold">PolyBot</h1>
        <p className="text-xs text-slate-400">Local simulator · manual entry only · not financial advice</p>
      </header>

      <section className="rounded-2xl bg-slate-900 p-4 shadow-lg">
        <div className="text-xs uppercase text-slate-400">Cash balance</div>
        <div className="text-4xl font-bold tabular-nums">{asUSD(cash)}</div>
        <div className="mt-2 flex justify-between text-sm text-slate-400">
          <span>Equity (MTM) <span className="text-slate-200">{asUSD(equity)}</span></span>
          <span>{state.positions.length} positions</span>
        </div>
      </section>

      <div className="flex gap-2">
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transactions…"
          className="flex-1 rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-sm"
        />
        <button
          onClick={() => setShowEntry(true)}
          className="rounded-xl bg-sky-500 hover:bg-sky-400 px-4 py-2 text-sm font-medium"
        >+ Record</button>
      </div>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Recent transactions</h2>
          <button onClick={onOpenMarkets} className="text-xs text-sky-400">Browse markets →</button>
        </div>
        {filtered.length === 0 ? (
          <div className="text-slate-400 text-sm p-8 text-center border border-dashed border-slate-800 rounded-2xl">
            No transactions yet. Tap <b>+ Record</b> to enter a trade you made on Polymarket.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-2xl bg-slate-900">
            {filtered.map((t) => (
              <li key={t.id} className="p-3 flex gap-3 items-center">
                <span className={`text-lg ${t.side === "BUY" ? "text-emerald-400" : "text-rose-400"}`}>
                  {t.side === "BUY" ? "↓" : "↑"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm">{t.side} {t.outcome} · {t.marketName || t.marketId}</div>
                  <div className="text-[11px] text-slate-400">{parseFloat(t.shares).toFixed(2)} sh @ {parseFloat(t.price).toFixed(2)}</div>
                </div>
                <div className="tabular-nums text-sm">{asUSD(t.notional)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showEntry && <TransactionEntry onClose={() => setShowEntry(false)} />}
    </div>
  );
}
