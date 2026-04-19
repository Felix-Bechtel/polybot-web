import { useState } from "react";
import { Market } from "../lib/types";
import { D, asOdds, asUSD } from "../lib/money";
import TransactionEntry from "./TransactionEntry";

export default function MarketDetail({ market, onBack }:
  { market: Market; onBack: () => void }) {
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [qty, setQty] = useState("1");
  const [recording, setRecording] = useState(false);

  const price = side === "YES" ? D(market.yesPrice) : D(market.noPrice);
  const notional = D(qty || "0").mul(price).toDecimalPlaces(2);

  return (
    <div className="p-4 space-y-4">
      <button onClick={onBack} className="text-sm text-signal">← Markets</button>
      <h1 className="text-lg font-semibold leading-snug">{market.question}</h1>
      <div className="flex gap-2 text-sm">
        <span className="px-2 py-1 rounded-full bg-emerald-500/15 text-yes">YES {asOdds(market.yesPrice)}</span>
        <span className="px-2 py-1 rounded-full bg-rose-500/15 text-no">NO {asOdds(market.noPrice)}</span>
        {market.url && (
          <a href={market.url} target="_blank" rel="noreferrer"
             className="ml-auto text-signal text-sm">Open on Polymarket ↗</a>
        )}
      </div>

      <section className="rounded-2xl bg-surface p-3 space-y-2">
        <h2 className="text-sm font-semibold">Order simulator</h2>
        <div className="flex rounded-xl bg-surface-hi p-1">
          {(["YES","NO"] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)}
              className={`flex-1 py-1.5 rounded-lg text-sm ${side === s ? "bg-signal text-white" : "text-slate-300"}`}>{s}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="w-16 text-slate-400">Shares</span>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)}
                 className="flex-1 rounded-xl bg-surface-hi border  px-3 py-2"/>
        </label>
        <div className="text-sm flex justify-between">
          <span className="text-slate-400">Price preview</span>
          <span className="tabular-nums">{asOdds(price)} → {asUSD(notional)}</span>
        </div>
        <button onClick={() => setRecording(true)}
          className="w-full rounded-xl bg-signal py-2 font-medium">
          Record BUY (after you trade on Polymarket)
        </button>
        <p className="text-xs text-amber-400">
          This app is SIMULATION only. Execute the real trade on Polymarket yourself, then record it here.
        </p>
      </section>

      <section className="rounded-2xl bg-surface p-3 space-y-1 text-sm">
        <h2 className="font-semibold">Mirror on real Polymarket</h2>
        <ol className="list-decimal ml-5 text-slate-300 space-y-1">
          <li>Open the market link above.</li>
          <li>Execute {side} × {qty} at the displayed price.</li>
          <li>Return here and tap <b>Record BUY</b>.</li>
        </ol>
      </section>

      {recording && (
        <TransactionEntry
          onClose={() => setRecording(false)}
          prefill={{
            marketId: market.id,
            marketName: market.question,
            outcome: side,
            side: "BUY",
            shares: qty,
            price: price.toFixed(4),
          }}
        />
      )}
    </div>
  );
}
