import { useEffect, useState } from "react";
import { db } from "../lib/db";
import { D, asUSD, normalizePrice, parseUserDecimal } from "../lib/money";
import { Outcome, Side } from "../lib/types";

interface Prefill {
  marketId?: string; marketName?: string; outcome?: Outcome; side?: Side;
  shares?: string; price?: string;
}

export default function TransactionEntry({
  onClose, prefill,
}: { onClose: () => void; prefill?: Prefill }) {
  const [marketId, setMarketId] = useState(prefill?.marketId ?? "");
  const [marketName, setMarketName] = useState(prefill?.marketName ?? "");
  const [outcome, setOutcome] = useState<Outcome>(prefill?.outcome ?? "YES");
  const [side, setSide] = useState<Side>(prefill?.side ?? "BUY");
  const [sharesStr, setShares] = useState(prefill?.shares ?? "1");
  const [priceStr, setPriceStr] = useState(prefill?.price ?? "0.50");
  const [feesStr, setFees] = useState("0");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shares = parseUserDecimal(sharesStr);
  const rawPrice = parseUserDecimal(priceStr);
  const price = rawPrice ? normalizePrice(rawPrice) : null;
  const fees = parseUserDecimal(feesStr) ?? D(0);

  const valid = !!shares && shares.greaterThan(0) && !!price
             && price.greaterThanOrEqualTo(0) && price.lessThanOrEqualTo(1)
             && marketId.trim().length > 0;
  const notional = valid ? shares!.mul(price!).plus(fees).toDecimalPlaces(2) : null;

  useEffect(() => setError(null), [marketId, sharesStr, priceStr, feesStr, side, outcome]);

  const save = () => {
    setError(null);
    if (!valid || !shares || !price) return;
    try {
      if (side === "BUY") {
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

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-md bg-surface rounded-t-3xl sm:rounded-3xl p-4 space-y-3 pb-safe">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Record transaction</h2>
          <button onClick={onClose} className="text-slate-400 text-sm">Cancel</button>
        </header>

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

        <div className="grid grid-cols-3 gap-3">
          <Field label="Shares"><input inputMode="decimal" value={sharesStr}
            onChange={(e) => setShares(e.target.value)} className={inputCls}/></Field>
          <Field label="Price"><input inputMode="decimal" value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)} className={inputCls}/></Field>
          <Field label="Fees"><input inputMode="decimal" value={feesStr}
            onChange={(e) => setFees(e.target.value)} className={inputCls}/></Field>
        </div>

        <Field label="Date">
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)}
                 className={inputCls}/>
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                    rows={2} className={inputCls}/>
        </Field>

        {notional && (
          <div className="text-sm text-slate-300 flex justify-between">
            <span className="text-slate-500">Preview</span>
            <span className="tabular-nums">
              {side === "BUY" ? "DEBIT " : "CREDIT "}{asUSD(notional)}
            </span>
          </div>
        )}
        {error && <div className="text-no text-sm">{error}</div>}

        {!confirming ? (
          <button onClick={() => setConfirming(true)} disabled={!valid}
            className="w-full rounded-xl bg-signal disabled:bg-surface-top py-3 font-medium">
            Review
          </button>
        ) : (
          <div className="space-y-2 border border-amber-500/40 bg-amber-950/30 rounded-xl p-3">
            <p className="text-sm">
              <b>{side}</b> {outcome} × {sharesStr} of <b>{marketName || marketId}</b> at {priceStr}.
              Notional {notional && asUSD(notional)}.
              <br/><span className="text-amber-200 text-xs">
                Only updates your LOCAL simulated portfolio. Execute the real trade on Polymarket yourself.
              </span>
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)}
                      className="flex-1 rounded-xl bg-surface-top py-2">Back</button>
              <button onClick={save}
                      className="flex-1 rounded-xl bg-yes py-2 font-medium">Confirm</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-xl bg-surface-hi border  px-3 py-2 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-slate-400 space-y-1">
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
          className={`flex-1 rounded-lg py-1.5 text-sm ${
            value === o ? "bg-signal text-white" : "text-slate-300"
          }`}>{o}</button>
      ))}
    </div>
  );
}
