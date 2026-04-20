import { useEffect, useState } from "react";
import { useDB } from "../lib/useDB";
import { db } from "../lib/db";
import { exportTransactionsCSV } from "../lib/csv";
import { clearClaudeKey, getClaudeKey, setClaudeKey } from "../lib/claude";
import {
  isRunning as schedulerRunning, start as startScheduler, stop as stopScheduler,
} from "../lib/scheduler";
import {
  ensureNotificationPermission, getNotificationPermission,
  getDiagnostics, sendTestNotification, NotifDiagnostics,
} from "../lib/notify";
import { CATEGORIES, mergeCategory, removeCategory } from "../lib/categories";
import {
  windowSummary, cumulativeTotals, avgPerAlert, clearUsage,
  onUsageChange, fmtK, fmtDuration, UsageWindow, WINDOW_MS,
} from "../lib/usage";
import { validPolygonAddress } from "../lib/polymarket-user";

function isStandalone(): boolean {
  // iOS
  // @ts-expect-error non-standard prop exposed on Safari
  if (typeof navigator !== "undefined" && navigator.standalone) return true;
  if (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return false;
}

function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
}

export default function Settings() {
  const state = useDB();
  const [key, setKey] = useState("");
  const [savedAt, setSavedAt] = useState(0);
  const [watchText, setWatchText] = useState(state.settings.watchlist.join(", "));
  const [installEvent, setInstallEvent] = useState<{ prompt: () => Promise<unknown> } | null>(null);
  const [notifState, setNotifState] = useState(getNotificationPermission());
  const [diag, setDiag] = useState<NotifDiagnostics | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageWindow>(() => windowSummary());
  const [cum, setCum] = useState(() => cumulativeTotals());
  const [avg, setAvg] = useState(() => avgPerAlert());
  const [walletDraft, setWalletDraft] = useState(state.settings.polymarketAddress ?? "");
  const hasKey = !!getClaudeKey();
  const running = schedulerRunning();
  const standalone = isStandalone();

  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstallEvent(e as unknown as { prompt: () => Promise<unknown> }); };
    window.addEventListener("beforeinstallprompt", h);
    void getDiagnostics().then(setDiag);
    const t = setInterval(() => { void getDiagnostics().then(setDiag); }, 3000);
    const u = onUsageChange((w) => { setUsage(w); setCum(cumulativeTotals()); setAvg(avgPerAlert()); });
    const tick = setInterval(() => { setUsage(windowSummary()); }, 30_000);
    return () => { window.removeEventListener("beforeinstallprompt", h); clearInterval(t); clearInterval(tick); u(); };
  }, []);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* INSTALL-AS-APP CARD — top of page so it's always visible */}
      <section className="rounded-2xl bg-gradient-to-br from-signal to-signal-hi p-4 space-y-2 shadow-lg">
        <h2 className="text-base font-semibold">📱 Install as app</h2>
        {standalone ? (
          <p className="text-sm">You're running PolyBot as an installed app. ✅</p>
        ) : isIOSSafari() ? (
          <>
            <p className="text-sm">Add PolyBot to your iPhone home screen to get push notifications and a full-screen app.</p>
            <ol className="text-xs list-decimal list-inside space-y-1 text-white/90">
              <li>Tap the <b>Share</b> icon (square + up-arrow) at the bottom of Safari.</li>
              <li>Scroll and tap <b>"Add to Home Screen"</b>.</li>
              <li>Name it <b>PolyBot</b> → <b>Add</b>. Launch it from the icon.</li>
            </ol>
            <p className="text-[11px] text-white/70">iOS only shows push notifications for PWAs installed to the Home Screen.</p>
          </>
        ) : installEvent ? (
          <>
            <p className="text-sm">Install PolyBot as a standalone app on this device.</p>
            <button
              onClick={() => installEvent.prompt()}
              className="w-full rounded-xl bg-white text-slate-900 py-2 text-sm font-semibold"
            >Install PolyBot</button>
          </>
        ) : (
          <>
            <p className="text-sm">Open this site on your iPhone in Safari and the install option will appear here.</p>
            <p className="text-[11px] text-white/70">On Android/desktop Chrome: ⋮ menu → "Install app".</p>
          </>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-3 space-y-2">
        <h2 className="text-sm font-semibold">Claude API key</h2>
        <input type="password" autoComplete="off" spellCheck={false}
          value={key} onChange={(e) => setKey(e.target.value)}
          placeholder={hasKey ? "•••••• (saved) " : "sk-ant-…"}
          className="w-full rounded-xl bg-surface-hi border  px-3 py-2 text-sm"/>
        <div className="flex gap-2">
          <button disabled={!key.trim()}
            onClick={() => { setClaudeKey(key.trim()); setKey(""); setSavedAt(Date.now()); }}
            className="flex-1 rounded-xl bg-signal py-2 text-sm disabled:bg-surface-top">
            Save to this device
          </button>
          {hasKey && (
            <button onClick={() => { clearClaudeKey(); setSavedAt(Date.now()); }}
              className="flex-1 rounded-xl bg-surface-top py-2 text-sm">
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
            className="rounded-lg bg-surface-hi border  px-2 py-1 text-sm w-56"/>
        </label>
      </section>

      {/* Polymarket account — live portfolio tracking */}
      <section className="rounded-2xl bg-surface p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">🔗 Polymarket account</h2>
          {state.settings.polymarketAddress && (
            <span className="text-[10px] bg-yes-bg text-yes px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">
              linked
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-400">
          Paste your Polymarket <b>proxy wallet address</b> and PolyBot will
          pull your real on-chain positions + trades every minute. Read-only —
          no private keys, we never place orders.
        </p>
        <input
          value={walletDraft}
          onChange={(e) => setWalletDraft(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
          className="w-full rounded-xl bg-surface-hi px-3 py-2 text-sm mono outline-none focus:bg-surface-top transition-colors"
        />
        <div className="flex gap-2">
          <button
            disabled={!walletDraft.trim() || !validPolygonAddress(walletDraft.trim())}
            onClick={() => db.setSettings({ polymarketAddress: walletDraft.trim().toLowerCase() })}
            className="flex-1 rounded-xl bg-signal py-2 text-sm font-semibold disabled:bg-surface-top disabled:text-slate-500"
          >Save address</button>
          {state.settings.polymarketAddress && (
            <button
              onClick={() => { db.setSettings({ polymarketAddress: undefined }); setWalletDraft(""); }}
              className="flex-1 rounded-xl bg-surface-top py-2 text-sm"
            >Unlink</button>
          )}
        </div>
        {walletDraft.trim() && !validPolygonAddress(walletDraft.trim()) && (
          <p className="text-[11px] text-warn">Invalid format — must be 0x followed by 40 hex chars.</p>
        )}
        <p className="text-[10px] text-slate-500">
          Find at polymarket.com → Profile (top-right avatar) → tap your address to copy.
        </p>
      </section>

      {/* Claude token usage — 5h rolling window */}
      <section className="rounded-2xl bg-surface p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Claude token usage</h2>
          <span className="text-[10px] text-slate-400">5-hr window</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Used in last 5h" value={fmtK(usage.total)} sub={`${usage.calls} call${usage.calls === 1 ? "" : "s"}`} accent/>
          <Stat label="Window resets in" value={fmtDuration(Math.max(0, usage.resetsAtMs - Date.now()))}
            sub={usage.calls === 0 ? "no calls tracked" : ""}/>
          <Stat label="Input" value={fmtK(usage.totalInput)} sub="tokens"/>
          <Stat label="Output" value={fmtK(usage.totalOutput)} sub="tokens"/>
          <Stat label="Per-alert avg" value={avg.calls === 0 ? "—" : `${fmtK(avg.input + avg.output)}`} sub={avg.calls === 0 ? "no samples yet" : `${fmtK(avg.input)} in / ${fmtK(avg.output)} out`}/>
          <Stat label="Cumulative" value={fmtK(cum.input + cum.output)} sub={`${cum.calls} call${cum.calls === 1 ? "" : "s"} all-time`}/>
        </div>

        {(usage.totalCacheRead > 0 || usage.totalCacheWrite > 0) && (
          <div className="text-[11px] text-slate-400">
            Prompt cache: {fmtK(usage.totalCacheRead)} read · {fmtK(usage.totalCacheWrite)} write
          </div>
        )}

        <p className="text-[11px] text-amber-300/90 leading-snug">
          ⚠️ Remaining <b>quota</b> can't be read from the API — Claude only reports what you <b>used</b>, not what's left.
          Your Claude.ai Pro/Max subscription quota resets every 5h <b>server-side</b>; this panel mirrors that cadence locally.
          For exact balance on an API key, check <span className="underline">console.anthropic.com</span>.
        </p>

        <button onClick={() => { if (confirm("Clear locally tracked usage?")) clearUsage(); }}
          className="w-full rounded-xl bg-surface-hi hover:bg-surface-top py-2 text-xs">
          Reset tracked usage
        </button>
      </section>

      <section className="rounded-2xl bg-surface p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">10-min alerts</h2>
          <button
            onClick={() => (running ? stopScheduler() : startScheduler())}
            className={`px-3 py-1 rounded-lg text-xs font-semibold ${
              running ? "bg-no" : "bg-yes"
            }`}
          >{running ? "Stop" : "Start"}</button>
        </div>
        <div className="rounded-xl bg-surface-hi p-3 space-y-2">
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>Check every</span>
            <span className="flex items-center gap-1">
              <input
                type="number" min={1} max={60}
                value={Math.round(state.settings.alertIntervalMs / 60000)}
                onChange={(e) => {
                  const mins = Math.max(1, Math.min(60, Number(e.target.value) || 10));
                  db.setSettings({ alertIntervalMs: mins * 60 * 1000 });
                  if (running) { stopScheduler(); startScheduler(); }
                }}
                className="w-16 rounded bg-surface border  px-2 py-1 text-center text-slate-100"
              />
              <span className="text-slate-400">min</span>
            </span>
          </label>
          <div className="flex flex-wrap gap-1">
            {[1, 5, 10, 15, 30, 60].map((m) => {
              const active = Math.round(state.settings.alertIntervalMs / 60000) === m;
              return (
                <button key={m}
                  onClick={() => {
                    db.setSettings({ alertIntervalMs: m * 60 * 1000 });
                    if (running) { stopScheduler(); startScheduler(); }
                  }}
                  className={`text-[11px] px-2 py-1 rounded-full border ${
                    active ? "bg-signal/20 text-signal-lo border-signal/40"
                           : "bg-surface text-slate-300 "
                  }`}
                >{m} min</button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400">
            Polls Polymarket + Reddit on this interval.
            {running ? " Will restart to apply new interval." : ""}
            {" "}Search does <b>not</b> use Claude tokens.
          </p>
        </div>

        {/* Notifications */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox"
              checked={state.settings.notificationsEnabled}
              onChange={async (e) => {
                db.setSettings({ notificationsEnabled: e.target.checked });
                if (e.target.checked) setNotifState(await ensureNotificationPermission());
              }}
              className="h-4 w-4"/>
            Phone/browser notifications
          </label>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
            notifState === "granted" ? "bg-emerald-500/20 text-yes"
            : notifState === "denied" ? "bg-rose-500/20 text-no"
            : "bg-surface-top text-slate-300"
          }`}>{notifState}</span>
        </div>
        {notifState === "denied" && (
          <p className="text-[11px] text-amber-400">
            Notifications are blocked. iPhone: install as app (top card) then re-enable. Desktop: browser site settings → allow notifications.
          </p>
        )}

        {/* Push diagnostics — essential on iPhone to see why push isn't firing */}
        {diag && (
          <div className="rounded-xl bg-surface-hi p-2 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">HTTPS / secure context</span>
              <span className={diag.secureContext ? "text-yes" : "text-no"}>
                {diag.secureContext ? "yes ✓" : "NO — iOS needs HTTPS"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Service worker</span>
              <span className={diag.serviceWorker === "registered" ? "text-yes" : "text-amber-300"}>
                {diag.serviceWorker}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Permission</span>
              <span className={diag.permission === "granted" ? "text-yes"
                : diag.permission === "denied" ? "text-no" : "text-slate-300"}>
                {diag.permission}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Installed as app</span>
              <span className={diag.standalone ? "text-yes" : "text-amber-300"}>
                {diag.standalone ? "yes ✓" : "not yet"}
              </span>
            </div>
            <button
              onClick={async () => {
                const r = await sendTestNotification();
                setTestMsg(r.ok ? "Sent ✓ — check your lock screen" : `Failed: ${r.reason}`);
                setNotifState(getNotificationPermission());
                setDiag(await getDiagnostics());
              }}
              className="w-full mt-1 rounded-lg bg-signal hover:bg-sky-400 py-1.5 text-xs font-semibold"
            >🔔 Send test notification</button>
            {testMsg && <div className="text-[11px] text-slate-300">{testMsg}</div>}
            {!diag.secureContext && (
              <p className="text-[11px] text-no pt-1">
                You're on plain HTTP. iOS silently refuses to enable push on non-HTTPS URLs. Use the HTTPS URL (scan the newest QR).
              </p>
            )}
            {diag.secureContext && !diag.standalone && (
              <p className="text-[11px] text-amber-300 pt-1">
                iOS only fires push on a PWA installed to the Home Screen. Tap the 📱 card at the top, follow the 3 steps, then relaunch.
              </p>
            )}
          </div>
        )}

        {/* Category chips */}
        <div>
          <div className="text-[11px] text-slate-400 mb-1">Quick-add categories</div>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((cat) => {
              const active = cat.terms.every((t) => state.settings.watchlist.includes(t));
              return (
                <button key={cat.id}
                  onClick={() => {
                    const next = active
                      ? removeCategory(state.settings.watchlist, cat)
                      : mergeCategory(state.settings.watchlist, cat);
                    db.setSettings({ watchlist: next });
                    setWatchText(next.join(", "));
                  }}
                  className={`text-[11px] px-2 py-1 rounded-full border ${
                    active ? "bg-signal/20 text-signal-lo border-signal/40"
                           : "bg-surface-hi text-slate-300 "
                  }`}
                >{cat.label}</button>
              );
            })}
          </div>
        </div>
        <label className="block text-xs text-slate-400">
          Watchlist (comma-separated keywords)
          <input
            value={watchText}
            onChange={(e) => setWatchText(e.target.value)}
            onBlur={() => db.setSettings({
              watchlist: watchText.split(",").map((s) => s.trim()).filter(Boolean),
            })}
            placeholder="bitcoin, eggs, election"
            className="mt-1 w-full rounded-xl bg-surface-hi border  px-3 py-2 text-sm text-slate-100"
          />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <ThresholdInput
            label="Social spike %"
            value={state.settings.thresholds.socialSpikePct}
            onChange={(v) => db.setSettings({
              thresholds: { ...state.settings.thresholds, socialSpikePct: v },
            })}
          />
          <ThresholdInput
            label="Price move %"
            value={state.settings.thresholds.priceMovePct}
            onChange={(v) => db.setSettings({
              thresholds: { ...state.settings.thresholds, priceMovePct: v },
            })}
          />
          <ThresholdInput
            label="Volume spike %"
            value={state.settings.thresholds.volumeSpikePct}
            onChange={(v) => db.setSettings({
              thresholds: { ...state.settings.thresholds, volumeSpikePct: v },
            })}
          />
        </div>
        <label className="flex items-center gap-2 text-xs pt-1">
          <input type="checkbox"
            checked={state.settings.opportunityScan}
            onChange={(e) => db.setSettings({ opportunityScan: e.target.checked })}
            className="h-4 w-4"/>
          Scan top-volume markets for undervalued YES candidates
        </label>
        <label className="block text-[11px] text-slate-400 pt-1">
          Take-profit trigger: alert when a position's current price is this %
          above your avg
          <input type="number" min={5} max={200} step={1}
            value={state.settings.priceRiseAlertPct}
            onChange={(e) => db.setSettings({
              priceRiseAlertPct: Math.max(5, Math.min(200, Number(e.target.value) || 25)),
            })}
            className="ml-2 w-16 rounded bg-surface-hi border  px-1 text-center text-slate-200"
          />%
        </label>
        <button
          onClick={() => { if (confirm("Clear all alerts history?")) db.clearAlerts(); }}
          className="w-full rounded-xl bg-surface-hi hover:bg-surface-top py-2 text-xs"
        >Clear alerts history</button>
      </section>

      <section className="rounded-2xl bg-surface p-3 space-y-2">
        <h2 className="text-sm font-semibold">Portfolio</h2>
        <label className="flex items-center gap-3">
          <input type="checkbox"
            checked={state.settings.allowOverdraft}
            onChange={(e) => db.setSettings({ allowOverdraft: e.target.checked })}
            className="h-4 w-4"/>
          <span className="text-sm">Allow overdraft (cash can go negative)</span>
        </label>
        <button onClick={() => exportTransactionsCSV(state.transactions)}
          className="w-full rounded-xl bg-surface-hi py-2 text-sm">
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

function Stat({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-xl p-2 ${accent ? "bg-signal/15 border border-signal/40" : "bg-surface-hi"}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-signal-lo" : "text-slate-100"}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

function ThresholdInput(
  { label, value, onChange }: { label: string; value: number; onChange: (v: number) => void },
) {
  return (
    <label className="block text-[11px] text-slate-400">
      {label}
      <input
        type="number" min={1} step={1} value={value}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
        className="mt-1 w-full rounded-lg bg-surface-hi border  px-2 py-1 text-sm text-slate-100"
      />
    </label>
  );
}
