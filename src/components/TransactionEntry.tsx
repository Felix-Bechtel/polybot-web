import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/db";
import { useDB } from "../lib/useDB";
import { D, asUSD, normalizePrice, parseUserDecimal } from "../lib/money";
import { Outcome, Side } from "../lib/types";
import { suggestSize } from "../lib/sizer";

interface Prefill {
  marketId?: string; marketName?: string; outcome?: Outcome; side?: Side;
  shares?: string; price?: string; url?: string;
}

export default function TransactionEntry({
  onClose, prefill,
}: { onClose: () => void; prefill?: Prefill }) {
  const state = useDB();
  const [marketId, setMarketId] = useState(prefill?.marketId ?? "");
  const [marketName, setMarketName] = useState(prefill?.marketName ?? "");
  const [outcome, setOutcome] = useState<Outcome>(prefill?.outcome ?? "YES");
  const [side, setSide] = useState<Side>(prefill?.side ?? "BUY");
  const [sharesStr, setShares] = useState(prefill?.shares ?? "");
  const [priceStr, setPriceStr] = useState(prefill?.price ?? "");
  const [feesStr, setFees] = useState("0");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [placeAsOrder, setPlaceAsOrder] = useState(true);  // open order by default
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shares = parseUserDecimal(sharesStr);
  const rawPrice = parseUserDecimal(priceStr);
  const price = rawPrice ? normalizePrice(rawPrice) : null;
  const fees = parseUserDecimal(feesStr) ?? D(0);

  // Position held for this market+outcome (used for SELL sizing + sanity).
  const positionShares = useMemo(() => {
    const p = state.positions.find(
      (p) => p.marketId === marketId && p.outcome === outcome,
    );
    return p?.shares;
  }, [state.positions, marketId, outcome]);

  // Recommendation — uses current price if set, otherwise assumes 0.50.
  const rec = useMemo(() => {
    if (!price) return null;
    return suggestSize({
      action: side,
      priceLimit: price.toString(),
      confidence: 65,                          // middle-of-road default
      cashBalance: state.settings.cashBalance,
      sharesHeld: positionShares,
    });
  }, [price, side, state.settings.cashBalance, positionShares]);

  const valid = !!shares && shares.greaterThan(0) && !!price
             && price.greaterThanOrEqualTo(0) && price.lessThanOrEqualTo(1)
             && marketId.trim().length > 0;
  const notional = valid ? shares!.mul(price!).plus(fees).toDecimalPlaces(2) : null;

  useEffect(() => setError(null), [marketId, sharesStr, priceStr, feesStr, side, outcome]);

  const save = () => {
    setError(null);
    if (!valid || !shares || !price) return;
    try {
      if (placeAsOrder) {
        db.placeOrder({
          marketId, marketName: marketName || marketId, outcome, side,
          limitPrice: price, shares,
          notes: notes || undefined, url: prefill?.url,
        });
      } else if (side === "BUY") {
        db.recordBuy({
          marketId, marketName: marketName || marketId, outcome,
          shares, price, fees,
          notes: notes || undefined, date: new Date(date),
        });
      } else {
        db.recordSell({
          marketId, outcome,
          shares, price, fees,
          notes: notes || undefined, date: new Date(date),
        });
      }
      onClose();
    } catch (e: any) {
      setError(e.message ?? String(e));
      setConfirming(false);
    }
  };

  const applySuggested = () => {
    if (!rec || !price) return;
    setShares(rec.shares);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-md bg-surface rounded-t-3xl sm:rounded-3xl p-4 space-y-3 pb-safe max-h-[92vh] overflow-y-auto">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {placeAsOrder ? "Place order" : "Record transaction"}
          </h2>
          <button onClick={onClose} className="text-slate-400 text-sm">Cancel</button>
        </header>

        {/* Place-as-open-order toggle */}
        <div className="flex items-center gap-3 bg-surface-hi rounded-xl p-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">
              {placeAsOrder ? "Open order (waiting to fill)" : "Already filled"}
            </div>
            <div className="text-[11px] text-slate-400">
              {placeAsOrder
                ? "You set a limit — mark fills in Positions → Open orders."
                : "You already executed this trade on Polymarket. Records immediately."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPlaceAsOrder(!placeAsOrder)}
            className={`shrink-0 w-11 h-6 rounded-full transition-colors ${
              placeAsOrder ? "bg-signal" : "bg-surface-top"
            }`}
          >
            <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
              placeAsOrder ? "translate-x-5" : "translate-x-0.5"
            }`}/>
          </button>
        </div>

        <Field label="Market id or slug">
          <input value={marketId} onChange={(e) => setMarketId(e.target.value)}
                 placeholder="POLY-BTC-100K" className={inputCls}/>
        </Field>
        <Field label="Market name (optional)">
          <input value={marketName} onChange={(e) => setMarketName(e.target.value)}
                 placeholder="Will BTC …" className={inputCls}/>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Outcome">
            <Segmented value={outcome} onChange={(v) => setOutcome(v as Outcome)}
                       options={["YES","NO"]}/>
          </Field>
          <Field label="Side">
            <Segmented value={side} onChange={(v) => setSide(v as Side)}
                       options={["BUY","SELL"]}/>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={placeAsOrder ? "Limit price" : "Fill price"}>
            <input inputMode="decimal" value={priceStr} placeholder="0.50"
              onChange={(e) => setPriceStr(e.target.value)} className={inputCls}/>
          </Field>
          <Field label="Shares">
            <input inputMode="decimal" value={sharesStr} placeholder="1.00"
              onChange={(e) => setShares(e.target.value)} className={inputCls}/>
          </Field>
        </div>

        {/* Recommendation chip — appears once price is set */}
        {rec && parseFloat(rec.dollars) > 0 && (
          <button
            type="button"
            onClick={applySuggested}
            className="w-full rounded-xl bg-signal/15 border border-signal/40 px-3 py-2.5 text-left active:bg-signal/25 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-signal-lo font-bold">
                  💡 Suggested size
                </div>
                <div className="mono text-sm text-signal-lo">
                  ~{rec.shares} sh · ${rec.dollars}
                </div>
              </div>
              <div className="text-[11px] text-slate-400 text-right">
                <div>{rec.reason}</div>
                <div className="text-signal-lo mt-0.5">tap to apply</div>
              </div>
            </div>
          </button>
        )}

        {!placeAsOrder && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fees">
              <input inputMode="decimal" value={feesStr}
                onChange={(e) => setFees(e.target.value)} className={inputCls}/>
            </Field>
            <Field label="Date">
              <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)}
                     className={inputCls}/>
            </Field>
          </div>
        )}

        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                    rows={2} className={inputCls}/>
        </Field>

        {notional && (
          <div className="text-sm flex justify-between">
            <span className="text-slate-500 text-xs uppercase tracking-wider">Notional</span>
            <span className="mono tabular-nums">
              {side === "BUY" ? "DEBIT " : "CREDIT "}{asUSD(notional)}
            </span>
          </div>
        )}
        {error && <div className="text-no text-sm">{error}</div>}

        {!confirming ? (
          <button onClick={() => setConfirming(true)} disabled={!valid}
            className="w-full rounded-xl bg-gradient-to-br from-signal-lo to-signal disabled:from-surface-top disabled:to-surface-top py-3 font-bold uppercase tracking-wider text-white">
            Review
          </button>
        ) : (
          <div className="space-y-2 rounded-xl bg-surface-hi p-3">
            <p className="text-sm">
              {placeAsOrder ? (
                <>Place <b>open {side}</b> for {sharesStr} × {outcome} of <b>{marketName || marketId}</b> at limit {priceStr}. Notional {notional && asUSD(notional)}.</>
              ) : (
                <><b>{side}</b> {outcome} × {sharesStr} of <b>{marketName || marketId}</b> at {priceStr}. Notional {notional && asUSD(notional)}.</>
              )}
              <br/><span className="text-warn text-xs">
                Execute the real trade on Polymarket yourself — PolyBot only tracks it.
              </span>
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)}
                      className="flex-1 rounded-xl bg-surface-top py-2">Back</button>
              <button onClick={save}
                      className={`flex-1 rounded-xl py-2 font-bold uppercase tracking-wider ${
                        side === "BUY" ? "bg-yes-bg text-yes" : "bg-no-bg text-no"
                      }`}>
                {placeAsOrder ? "Place order" : "Confirm"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-xl bg-surface-hi px-3 py-2 text-sm outline-none focus:bg-surface-top transition-colors mono";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[10px] uppercase tracking-wider text-slate-500 space-y-1">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Segmented({ value, onChange, options }:
  { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex rounded-xl bg-surface-hi p-1">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${
            value === o ? "bg-signal text-white" : "text-slate-300"
          }`}>{o}</button>
      ))}
    </div>
  );
}
