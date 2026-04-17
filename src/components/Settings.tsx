import { useState } from "react";
import { useDB } from "../lib/useDB";
import { db } from "../lib/db";
import { exportTransactionsCSV } from "../lib/csv";
import { clearClaudeKey, getClaudeKey, setClaudeKey } from "../lib/claude";

export default function Settings() {
  const state = useDB();
  const [key, setKey] = useState("");
  const [savedAt, setSavedAt] = useState(0);
  const hasKey = !!getClaudeKey();

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="rounded-2xl bg-slate-900 p-3 space-y-2">
        <h2 className="text-sm font-semibold">Claude API key</h2>
        <input type="password" autoComplete="off" spellCheck={false}
          value={key} onChange={(e) => setKey(e.target.value)}
          placeholder={hasKey ? "•••••• (saved) " : "sk-ant-…"}
          className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-sm"/>
        <div className="flex gap-2">
          <button disabled={!key.trim()}
            onClick={() => { setClaudeKey(key.trim()); setKey(""); setSavedAt(Date.now()); }}
            className="flex-1 rounded-xl bg-sky-500 py-2 text-sm disabled:bg-slate-700">
            Save to this device
          </button>
          {hasKey && (
            <button onClick={() => { clearClaudeKey(); setSavedAt(Date.now()); }}
              className="flex-1 rounded-xl bg-slate-700 py-2 text-sm">
              Clear key
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400">
          Key lives in this browser's localStorage. Never transmitted except directly to Anthropic. {savedAt ? "Updated." : ""}
        </p>
        <label className="flex items-center gap-2 text-sm pt-1">
          <span className="text-slate-400 flex-1">Model</span>
          <input value={state.settings.claudeModel}
            onChange={(e) => db.setSettings({ claudeModel: e.target.value })}
            className="rounded-lg bg-slate-800 border border-slate-700 px-2 py-1 text-sm w-56"/>
        </label>
      </section>

      <section className="rounded-2xl bg-slate-900 p-3 space-y-2">
        <h2 className="text-sm font-semibold">Portfolio</h2>
        <label className="flex items-center gap-3">
          <input type="checkbox"
            checked={state.settings.allowOverdraft}
            onChange={(e) => db.setSettings({ allowOverdraft: e.target.checked })}
            className="h-4 w-4"/>
          <span className="text-sm">Allow overdraft (cash can go negative)</span>
        </label>
        <button onClick={() => exportTransactionsCSV(state.transactions)}
          className="w-full rounded-xl bg-slate-800 py-2 text-sm">
          Export transactions (CSV)
        </button>
        <button onClick={() => {
            if (confirm("Wipe all positions + transactions and reset cash to $1.15?")) {
              db.reset();
            }
          }}
          className="w-full rounded-xl bg-rose-600/70 py-2 text-sm">
          Reset all data
        </button>
      </section>

      <section className="text-xs text-slate-400 px-1">
        <p>v0.1 · PolyBot only simulates trades locally. No SMS, no auto-trading, no backend server. ⚠️ Not financial advice.</p>
        <p>Installed cash: <span className="text-slate-200">{state.settings.cashBalance}</span> · Positions: {state.positions.length} · Transactions: {state.transactions.length}</p>
      </section>
    </div>
  );
}
