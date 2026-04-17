import { useEffect, useState } from "react";
import { useDB } from "../lib/useDB";
import { Position } from "../lib/types";
import { fetchMarket } from "../lib/polymarket";
import { D, asOdds, asUSD } from "../lib/money";
import TransactionEntry from "./TransactionEntry";

type LivePrice = { yes: string; no: string };

export default function Portfolio() {
  const state = useDB();
  const [live, setLive] = useState<Record<string, LivePrice>>({});
  const [active, setActive] = useState<{ position: Position; side: "BUY" | "SELL" } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = Array.from(new Set(state.positions.map((p) => p.marketId)));
      const out: Record<string, LivePrice> = {};
      for (const id of ids) {
        const m = await fetchMarket(id);
        if (m) out[id] = { yes: m.yesPrice, no: m.noPrice };
      }
      if (!cancelled) setLive(out);
    })();
    return () => { cancelled = true; };
  }, [state.positions.length]);

  const positions = state.positions;

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-semibold">Portfolio</h1>
      {positions.length === 0 ? (
        <div className="text-slate-400 text-sm p-8 text-center border border-dashed border-slate-800 rounded-2xl">
          No open positions. Record a BUY from Markets or Chat.
        </div>
      ) : (
        <ul className="space-y-2">
          {positions.map((p) => {
            const cur = live[p.marketId];
            const curPrice = cur ? (p.outcome === "YES" ? cur.yes : cur.no) : p.avgPrice;
            const pnl = D(curPrice).minus(D(p.avgPrice)).mul(D(p.shares));
            return (
              <li key={p.id} className="rounded-2xl bg-slate-900 p-3 space-y-2">
                <div className="text-sm line-clamp-1">{p.marketName || p.marketId}</div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                  <span>{p.outcome} × {parseFloat(p.shares).toFixed(2)}</span>
                  <span>avg {asOdds(p.avgPrice)} · now {asOdds(curPrice)}</span>
                  <span className={`ml-auto tabular-nums ${pnl.isNegative() ? "text-rose-400" : "text-emerald-400"}`}>
                    {asUSD(pnl)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setActive({ position: p, side: "BUY" })}
                    className="flex-1 rounded-xl bg-slate-800 py-1.5 text-sm">Buy more</button>
                  <button onClick={() => setActive({ position: p, side: "SELL" })}
                    className="flex-1 rounded-xl bg-sky-500 py-1.5 text-sm font-medium">Sell</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {active && (
        <TransactionEntry
          onClose={() => setActive(null)}
          prefill={{
            marketId: active.position.marketId,
            marketName: active.position.marketName,
            outcome: active.position.outcome,
            side: active.side,
            shares: active.position.shares,
            price: live[active.position.marketId]
              ? (active.position.outcome === "YES" ? live[active.position.marketId].yes : live[active.position.marketId].no)
              : active.position.avgPrice,
          }}
        />
      )}
    </div>
  );
}
