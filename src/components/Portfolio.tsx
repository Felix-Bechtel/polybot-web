import { useEffect, useState } from "react";
import { useDB } from "../lib/useDB";
import { db } from "../lib/db";
import { PendingOrder, Position } from "../lib/types";
import { fetchMarket, normalizePolymarketUrl } from "../lib/polymarket";
import { fetchUserPositions, PolyUserPosition } from "../lib/polymarket-user";
import { D, asOdds, asUSD, parseUserDecimal } from "../lib/money";
import TransactionEntry from "./TransactionEntry";

type LivePrice = { yes: string; no: string };

export default function Portfolio() {
  const state = useDB();
  const [live, setLive] = useState<Record<string, LivePrice>>({});
  const [active, setActive] = useState<{ position: Position; side: "BUY" | "SELL" } | null>(null);
  const [fillingId, setFillingId] = useState<string | null>(null);
  const [fillInput, setFillInput] = useState("");
  const [livePositions, setLivePositions] = useState<PolyUserPosition[] | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  // Pull real Polymarket positions if the user has pasted their proxy address.
  const addr = state.settings.polymarketAddress ?? "";
  useEffect(() => {
    if (!addr) { setLivePositions(null); return; }
    let cancelled = false;
    const load = async () => {
      setLiveLoading(true);
      const positions = await fetchUserPositions(addr);
      if (!cancelled) { setLivePositions(positions); setLiveLoading(false); }
    };
    void load();
    const h = setInterval(() => { void load(); }, 60_000);
    return () => { cancelled = true; clearInterval(h); };
  }, [addr]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = Array.from(new Set([
        ...state.positions.map((p) => p.marketId),
        ...state.pendingOrders.map((o) => o.marketId),
      ]));
      const out: Record<string, LivePrice> = {};
      for (const id of ids) {
        const m = await fetchMarket(id);
        if (m) out[id] = { yes: m.yesPrice, no: m.noPrice };
      }
      if (!cancelled) setLive(out);
    })();
    return () => { cancelled = true; };
  }, [state.positions.length, state.pendingOrders.length]);

  const positions = state.positions;
  const openOrders = state.pendingOrders.filter((o) => o.status === "open" || o.status === "partial");
  const closedOrders = state.pendingOrders.filter((o) => o.status === "filled" || o.status === "cancelled").slice(0, 10);

  return (
    <div className="p-5 space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Portfolio</h1>
        <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500 mt-1">
          Live Polymarket · local simulation · open orders
        </p>
      </header>

      {/* LIVE POLYMARKET ACCOUNT — only when wallet address is set */}
      {addr ? (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[10px] uppercase tracking-[0.15em] text-slate-500">
              🟢 Live Polymarket account
            </h2>
            <span className="mono text-[10px] text-slate-500">
              {addr.slice(0, 6)}…{addr.slice(-4)}
            </span>
          </div>
          {livePositions === null || liveLoading ? (
            <div className="text-slate-500 text-sm p-6 text-center rounded-2xl bg-surface">
              Loading positions…
            </div>
          ) : livePositions.length === 0 ? (
            <div className="text-slate-500 text-sm p-6 text-center rounded-2xl bg-surface">
              No on-chain positions found for this wallet.
            </div>
          ) : (
            <ul className="space-y-3">
              {livePositions.map((p) => {
                const up = p.cashPnl >= 0;
                return (
                  <li key={p.conditionId} className="rounded-2xl bg-surface p-4">
                    <a href={p.url ? normalizePolymarketUrl(p.url) : "#"}
                       target="_blank" rel="noreferrer"
                       className="block">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[9px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider bg-yes-bg text-yes">
                          {p.outcome}
                        </span>
                        <span className={`ml-auto mono text-xs font-semibold ${up ? "text-yes" : "text-no"}`}>
                          {up ? "+" : ""}${p.cashPnl.toFixed(2)} · {up ? "+" : ""}{p.percentPnl.toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-sm font-semibold line-clamp-2">{p.eventTitle}</div>
                      <div className="mt-2 flex gap-3 text-[11px] text-slate-400">
                        <span className="mono">{p.size.toFixed(2)} sh</span>
                        <span className="mono">avg ${p.avgPrice.toFixed(3)}</span>
                        <span className="mono">now ${p.currentPrice.toFixed(3)}</span>
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <div className="rounded-2xl bg-surface p-4 space-y-2 border border-signal/30">
          <div className="text-sm font-semibold flex items-center gap-2">
            🔗 <span>Track your real Polymarket account</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Paste your Polymarket <b>proxy wallet address</b> in Settings and
            PolyBot will auto-track your on-chain positions + trades here
            (read-only, no private keys).
          </p>
          <p className="text-[10px] text-slate-500">
            Find it at polymarket.com → Profile → Copy Address.
          </p>
        </div>
      )}

      {/* OPEN ORDERS — first-class section */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Open orders</h2>
          {openOrders.length > 0 && (
            <span className="mono text-[11px] text-slate-500">{openOrders.length}</span>
          )}
        </div>
        {openOrders.length === 0 ? (
          <div className="text-slate-500 text-sm p-6 text-center rounded-2xl bg-surface">
            No open orders. Use <b>+ REC</b> on Home → leave "Open order" toggle on.
          </div>
        ) : (
          <ul className="space-y-3">
            {openOrders.map((o) => (
              <OpenOrderCard
                key={o.id}
                order={o}
                live={live[o.marketId]}
                filling={fillingId === o.id}
                fillInput={fillInput}
                onOpenFill={() => { setFillingId(o.id); setFillInput(""); }}
                onCancel={() => db.cancelOrder(o.id)}
                onFillInput={setFillInput}
                onFillSubmit={(kind) => {
                  try {
                    if (kind === "all") db.fillOrder(o.id, "all");
                    else {
                      const amt = parseUserDecimal(fillInput);
                      if (!amt || amt.lessThanOrEqualTo(0)) return;
                      db.fillOrder(o.id, amt);
                    }
                    setFillingId(null);
                  } catch (e: any) { alert(e.message); }
                }}
                onDismiss={() => setFillingId(null)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* POSITIONS */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Positions</h2>
          {positions.length > 0 && (
            <span className="mono text-[11px] text-slate-500">{positions.length}</span>
          )}
        </div>
        {positions.length === 0 ? (
          <div className="text-slate-500 text-sm p-6 text-center rounded-2xl bg-surface">
            No open positions.
          </div>
        ) : (
          <ul className="space-y-3">
            {positions.map((p) => {
              const cur = live[p.marketId];
              const curPrice = cur ? (p.outcome === "YES" ? cur.yes : cur.no) : p.avgPrice;
              const pnl = D(curPrice).minus(D(p.avgPrice)).mul(D(p.shares));
              return (
                <li key={p.id} className="rounded-2xl bg-surface p-4 space-y-3">
                  <div>
                    <div className="text-sm font-semibold line-clamp-2">{p.marketName || p.marketId}</div>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs">
                      <span className="mono">{p.outcome} × {parseFloat(p.shares).toFixed(2)}</span>
                      <span className="text-slate-400 mono">avg {asOdds(p.avgPrice)} · now {asOdds(curPrice)}</span>
                      <span className={`ml-auto mono font-semibold ${pnl.isNegative() ? "text-no" : "text-yes"}`}>
                        {asUSD(pnl)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setActive({ position: p, side: "BUY" })}
                      className="flex-1 rounded-xl bg-surface-hi py-2 text-xs font-bold uppercase tracking-wider">Buy more</button>
                    <button onClick={() => setActive({ position: p, side: "SELL" })}
                      className="flex-1 rounded-xl bg-no-bg text-no py-2 text-xs font-bold uppercase tracking-wider">Sell</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* CLOSED / CANCELLED ORDERS — last 10 */}
      {closedOrders.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Recent fills / cancels</h2>
          <ul className="rounded-2xl bg-surface divide-y divide-surface-hi">
            {closedOrders.map((o) => (
              <li key={o.id} className="p-3 flex gap-3 items-center">
                <span className={`text-[9px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider shrink-0 ${
                  o.status === "filled"
                    ? "bg-yes-bg text-yes"
                    : "bg-surface-top text-slate-400"
                }`}>{o.status}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate">{o.side} {o.outcome} · {o.marketName}</div>
                  <div className="mono text-[10px] text-slate-500">
                    {parseFloat(o.filledShares).toFixed(2)}/{parseFloat(o.shares).toFixed(2)} @ {o.limitPrice}
                  </div>
                </div>
                <button onClick={() => db.deleteOrder(o.id)}
                  className="text-[10px] text-slate-500 uppercase tracking-wider">Clear</button>
              </li>
            ))}
          </ul>
        </section>
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

function OpenOrderCard({
  order, live, filling, fillInput,
  onOpenFill, onCancel, onFillInput, onFillSubmit, onDismiss,
}: {
  order: PendingOrder;
  live?: LivePrice;
  filling: boolean;
  fillInput: string;
  onOpenFill: () => void;
  onCancel: () => void;
  onFillInput: (v: string) => void;
  onFillSubmit: (kind: "all" | "custom") => void;
  onDismiss: () => void;
}) {
  const filled = D(order.filledShares);
  const total = D(order.shares);
  const remaining = total.minus(filled);
  const pct = filled.div(total).mul(100).toDecimalPlaces(0);
  const curLive = live
    ? (order.outcome === "YES" ? live.yes : live.no)
    : null;
  const distance = curLive
    ? (parseFloat(curLive) - parseFloat(order.limitPrice)) * 100
    : null;
  const isBuy = order.side === "BUY";

  return (
    <li className="rounded-2xl bg-surface p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[9px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider ${
              isBuy ? "bg-yes-bg text-yes" : "bg-no-bg text-no"
            }`}>{order.side} {order.outcome}</span>
            <span className={`text-[9px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider ${
              order.status === "partial" ? "bg-warn/20 text-warn" : "bg-surface-top text-slate-400"
            }`}>{order.status}</span>
          </div>
          <div className="text-sm font-semibold line-clamp-2">{order.marketName}</div>
        </div>
        {order.url && (
          <a href={normalizePolymarketUrl(order.url)} target="_blank" rel="noreferrer"
            className="text-[10px] uppercase tracking-wider text-signal-lo shrink-0">↗</a>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Limit" value={order.limitPrice} mono/>
        <Stat label="Remaining" value={remaining.toDecimalPlaces(2).toString()} mono/>
        <Stat label="Cost" value={`$${remaining.mul(D(order.limitPrice)).toDecimalPlaces(2).toString()}`} mono/>
      </div>

      {curLive && (
        <div className="text-[11px] text-slate-500">
          Market now <span className="mono text-slate-300">{curLive}</span>
          {distance != null && (
            <span className={`ml-2 mono ${
              (isBuy ? distance <= 0 : distance >= 0) ? "text-yes" : "text-warn"
            }`}>
              ({distance >= 0 ? "+" : ""}{distance.toFixed(1)}pp vs limit)
            </span>
          )}
        </div>
      )}

      {/* fill progress bar */}
      {!filled.isZero() && (
        <div>
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            <span>Filled</span>
            <span className="mono">{filled.toString()}/{total.toString()} · {pct.toString()}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-hi overflow-hidden">
            <div className="h-full bg-yes" style={{ width: `${pct.toNumber()}%` }}/>
          </div>
        </div>
      )}

      {filling ? (
        <div className="space-y-2 rounded-xl bg-surface-hi p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Mark filled</div>
          <input
            inputMode="decimal"
            value={fillInput}
            onChange={(e) => onFillInput(e.target.value)}
            placeholder={`Shares filled (max ${remaining.toString()})`}
            className="w-full rounded-lg bg-surface-top px-3 py-2 text-sm mono outline-none"
          />
          <div className="flex gap-2">
            <button onClick={onDismiss}
              className="flex-1 rounded-lg bg-surface-top py-2 text-xs uppercase tracking-wider">Back</button>
            <button onClick={() => onFillSubmit("custom")}
              className="flex-1 rounded-lg bg-surface-top py-2 text-xs font-bold uppercase tracking-wider">Fill amount</button>
            <button onClick={() => onFillSubmit("all")}
              className="flex-1 rounded-lg bg-yes-bg text-yes py-2 text-xs font-bold uppercase tracking-wider">Fill all</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 rounded-xl bg-surface-hi py-2 text-xs font-bold uppercase tracking-wider text-slate-300">Cancel</button>
          <button onClick={onOpenFill}
            className="flex-1 rounded-xl bg-gradient-to-br from-signal-lo to-signal text-white py-2 text-xs font-bold uppercase tracking-wider">Mark filled</button>
        </div>
      )}
    </li>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-hi py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm font-semibold text-slate-100 ${mono ? "mono" : ""}`}>{value}</div>
    </div>
  );
}
