// 10-min polling engine. Runs only while the PWA is foregrounded.
// Sources that work browser-direct:
//   - Polymarket Gamma REST (public, CORS-ok)
//   - Reddit public JSON endpoints (CORS-ok, unauthenticated)
// Twitter/X is not included — the browser can't call the v2 API without a
// backend proxy. If/when a backend exists, add it here behind the same API.
//
// Background limitation: iOS pauses JS timers when Safari is backgrounded.
// Real 10-min push requires a backend + APNs. This scheduler gives you:
//   - Accurate 10-min checks while the app is open
//   - A "Check now" button for on-demand
//   - Alerts persisted so backgrounded ticks still show up when you return

import Decimal from "decimal.js";
import { db } from "./db";
import { Alert, Market, Outcome, Side } from "./types";
import { fetchTopMarkets, searchMarkets } from "./polymarket";
import { askClaude, getClaudeKey } from "./claude";
import { notifyAlerts, ensureNotificationPermission } from "./notify";
import { suggestSize } from "./sizer";
import { fetchUserPositions, fetchUserTrades, PolyUserPosition } from "./polymarket-user";
import { matchTradesToOrders } from "./order-matcher";

interface Snapshot {
  priceYes: Record<string, string>;   // marketId -> last yesPrice
  volume24h: Record<string, string>;  // marketId -> last volume24h
  mentions: Record<string, number>;   // entity -> last mention count
  marketsByEntity: Record<string, string[]>; // entity -> marketIds (most recent)
}

const SNAP_KEY = "polybot.scheduler.snapshot.v1";

function loadSnap(): Snapshot {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    if (!raw) return empty();
    return { ...empty(), ...(JSON.parse(raw) as Snapshot) };
  } catch { return empty(); }
}
function saveSnap(s: Snapshot): void { localStorage.setItem(SNAP_KEY, JSON.stringify(s)); }
function empty(): Snapshot {
  return { priceYes: {}, volume24h: {}, mentions: {}, marketsByEntity: {} };
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Reddit public JSON — count recent posts mentioning `q` in the last hour. */
async function redditMentions(q: string): Promise<number> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&t=hour&limit=100`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return 0;
    const data = (await res.json()) as { data?: { children?: unknown[] } };
    return data.data?.children?.length ?? 0;
  } catch { return 0; }
}

interface Listener { (): void }
const listeners = new Set<Listener>();
export function onSchedulerChange(fn: Listener): () => void {
  listeners.add(fn); return () => listeners.delete(fn);
}
function notify() { listeners.forEach((l) => l()); }

let timer: number | null = null;
let running = false;                  // tick in flight
let lastStatus: string = "idle";      // "idle" | "checking" | "error: ..."

export function getStatus(): string { return lastStatus; }

export function start(): void {
  if (timer != null) return;
  const { alertIntervalMs, notificationsEnabled } = db.load().settings;
  db.setSettings({ alertsEnabled: true });
  if (notificationsEnabled) void ensureNotificationPermission();
  // Fire immediately so the user sees something happen, then on interval.
  void tick();
  timer = window.setInterval(() => { void tick(); }, alertIntervalMs);
  notify();
}

export function stop(): void {
  if (timer != null) { clearInterval(timer); timer = null; }
  db.setSettings({ alertsEnabled: false });
  notify();
}

export function isRunning(): boolean { return timer != null; }

export async function checkNow(): Promise<void> {
  await tick();
}

/** A single polling tick. Safe to call concurrently (no-op if one is in flight). */
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  lastStatus = "checking";
  notify();
  try {
    const st = db.load();
    const watch = (st.settings.watchlist ?? []).map((s) => s.trim()).filter(Boolean);
    if (watch.length === 0) {
      lastStatus = "idle (empty watchlist)";
      db.setSettings({ lastCheckedAt: new Date().toISOString() });
      return;
    }
    const snap = loadSnap();
    const next: Snapshot = { ...empty() };
    const newAlerts: Alert[] = [];

    // Fan out: one Polymarket search + one Reddit count per entity.
    const results = await Promise.all(watch.map(async (entity) => {
      const [markets, mentions] = await Promise.all([
        searchMarkets(entity, 20),
        redditMentions(entity),
      ]);
      return { entity, markets, mentions };
    }));

    const t = st.settings.thresholds;

    for (const { entity, markets, mentions } of results) {
      next.mentions[entity] = mentions;
      next.marketsByEntity[entity] = markets.map((m) => m.id);

      const prevMentions = snap.mentions[entity];
      const spikePct = prevMentions && prevMentions > 0
        ? ((mentions - prevMentions) / prevMentions) * 100
        : 0;

      for (const m of markets) {
        next.priceYes[m.id] = m.yesPrice;
        next.volume24h[m.id] = m.volume24h;

        const prevP = snap.priceYes[m.id];
        const prevV = snap.volume24h[m.id];
        if (prevP == null) continue;               // need a baseline
        const dp = (parseFloat(m.yesPrice) - parseFloat(prevP)) * 100; // points, [-100,100]
        const dv = prevV && parseFloat(prevV) > 0
          ? ((parseFloat(m.volume24h) - parseFloat(prevV)) / parseFloat(prevV)) * 100
          : 0;

        const social = mentions >= t.minMentions && spikePct >= t.socialSpikePct;
        const market = Math.abs(dp) >= t.priceMovePct || dv >= t.volumeSpikePct;
        if (!(social && market)) continue;

        const action: Side = dp >= 0 ? "BUY" : "SELL";
        const outcome: Outcome = dp >= 0 ? "YES" : "NO";
        const confidence = Math.min(
          100,
          Math.round(
            30 +
            Math.min(40, Math.abs(dp) * 6) +
            Math.min(30, (spikePct / t.socialSpikePct) * 15),
          ),
        );
        const priceLimit = clamp01(
          action === "BUY"
            ? new Decimal(m.yesPrice).plus(0.03)
            : new Decimal(m.yesPrice).minus(0.03),
        );
        const rationale =
          `Reddit mentions ${prevMentions}→${mentions} (+${spikePct.toFixed(0)}%), ` +
          `Yes ${(parseFloat(prevP) * 100).toFixed(0)}¢→${(parseFloat(m.yesPrice) * 100).toFixed(0)}¢ ` +
          `(${dp >= 0 ? "+" : ""}${dp.toFixed(1)}pp)`;

        const alert: Alert = {
          id: uuid(),
          createdAt: new Date().toISOString(),
          kind: "signal",
          marketId: m.id,
          marketName: m.question,
          outcome,
          action,
          priceLimit,
          confidence,
          rationale,
          url: m.url,
        };

        if (getClaudeKey()) { void enrichWithClaude(alert, m, mentions, spikePct, dp).catch(() => {}); }
        newAlerts.push(alert);
      }
    }

    // Scanner 2: undervalued-YES candidates from top-volume markets.
    // Fires on first tick (no baseline needed) so the user sees alerts fast.
    if (st.settings.opportunityScan) {
      try {
        const top = await fetchTopMarkets(150);
        const emittedIds = new Set<string>();
        // Tier 1: high-confidence — needs baseline + trending up.
        for (const m of top) {
          const yes = parseFloat(m.yesPrice);
          const vol = parseFloat(m.volume24h);
          if (!(yes >= 0.15 && yes <= 0.60 && vol >= 5_000)) continue;
          const prevP = snap.priceYes[m.id];
          if (prevP == null) continue;
          const dp = (yes - parseFloat(prevP)) * 100;
          if (dp < 0.5) continue;

          newAlerts.push({
            id: uuid(),
            createdAt: new Date().toISOString(),
            kind: "opportunity",
            marketId: m.id,
            marketName: m.question,
            outcome: "YES",
            action: "BUY",
            priceLimit: clamp01(new Decimal(m.yesPrice).plus(0.02)),
            confidence: Math.min(90, Math.round(50 + dp * 4 + Math.log10(vol + 1) * 4)),
            rationale:
              `Underpriced YES at ${(yes * 100).toFixed(0)}¢ · 24h vol $${Math.round(vol).toLocaleString()} · ` +
              `+${dp.toFixed(1)}pp in last ${Math.round(st.settings.alertIntervalMs / 60000)}m`,
            url: m.url,
          });
          emittedIds.add(m.id);
          next.priceYes[m.id] = m.yesPrice;
          next.volume24h[m.id] = m.volume24h;
        }
        // Tier 2: baseline-free value picks — always populate snapshot + emit
        // up to 3 best candidates the first time through so the user isn't
        // staring at an empty alerts feed on tick #1.
        const tier2 = top
          .filter((m) => !emittedIds.has(m.id))
          .filter((m) => {
            const y = parseFloat(m.yesPrice), v = parseFloat(m.volume24h);
            return isFinite(y) && v >= 1_000 && ((y >= 0.10 && y <= 0.60) || (y >= 0.65 && y <= 0.90));
          })
          .sort((a, b) => parseFloat(b.volume24h) - parseFloat(a.volume24h))
          .slice(0, 3);
        for (const m of tier2) {
          next.priceYes[m.id] = m.yesPrice;
          next.volume24h[m.id] = m.volume24h;
          const yes = parseFloat(m.yesPrice);
          const cheap = yes <= 0.60;
          newAlerts.push({
            id: uuid(),
            createdAt: new Date().toISOString(),
            kind: "opportunity",
            marketId: m.id,
            marketName: m.question,
            outcome: cheap ? "YES" : "NO",
            action: "BUY",
            priceLimit: clamp01(new Decimal(cheap ? yes : (1 - yes)).plus(0.02)),
            confidence: Math.min(60, Math.round(35 + Math.log10(parseFloat(m.volume24h) + 1) * 4)),
            rationale: cheap
              ? `Value YES @ ${(yes * 100).toFixed(0)}¢ · 24h vol $${Math.round(parseFloat(m.volume24h)).toLocaleString()}`
              : `Value NO @ ${((1 - yes) * 100).toFixed(0)}¢ · 24h vol $${Math.round(parseFloat(m.volume24h)).toLocaleString()}`,
            url: m.url,
          });
        }
      } catch { /* non-fatal */ }
    }

    // Scanner 3: portfolio take-profit / cut-loss.
    for (const pos of st.positions) {
      try {
        const live = (await searchMarkets(pos.marketId, 5))[0]
                  ?? (await searchMarkets(pos.marketName, 5))[0];
        if (!live) continue;
        next.priceYes[live.id] = live.yesPrice;
        next.volume24h[live.id] = live.volume24h;

        const nowPrice = pos.outcome === "YES"
          ? parseFloat(live.yesPrice) : parseFloat(live.noPrice);
        const avg = parseFloat(pos.avgPrice);
        if (avg <= 0) continue;
        const risePct = ((nowPrice - avg) / avg) * 100;

        if (risePct >= st.settings.priceRiseAlertPct) {
          newAlerts.push({
            id: uuid(),
            createdAt: new Date().toISOString(),
            kind: "take-profit",
            marketId: live.id,
            marketName: live.question,
            outcome: pos.outcome,
            action: "SELL",
            priceLimit: clamp01(new Decimal(nowPrice).minus(0.01)),
            confidence: Math.min(95, Math.round(50 + Math.min(40, risePct / 2))),
            rationale:
              `Your avg ${avg.toFixed(2)} → now ${nowPrice.toFixed(2)} (+${risePct.toFixed(0)}%). ` +
              `Consider locking profit on ${pos.shares} shares.`,
            url: live.url,
          });
        } else if (risePct <= -30) {
          newAlerts.push({
            id: uuid(),
            createdAt: new Date().toISOString(),
            kind: "cut-loss",
            marketId: live.id,
            marketName: live.question,
            outcome: pos.outcome,
            action: "SELL",
            priceLimit: clamp01(new Decimal(nowPrice).minus(0.01)),
            confidence: Math.min(80, Math.round(40 + Math.min(35, -risePct / 2))),
            rationale:
              `Your avg ${avg.toFixed(2)} → now ${nowPrice.toFixed(2)} (${risePct.toFixed(0)}%). ` +
              `Consider cutting losses on ${pos.shares} shares.`,
            url: live.url,
          });
        }
      } catch { /* per-position failure is non-fatal */ }
    }

    // Scanner 4: Live Polymarket account (when wallet address is linked).
    // Detects big swings on the user's real on-chain positions and emits
    // alerts that deep-link to the Polymarket event page so one tap puts
    // them on the right market to sell.
    const wallet = st.settings.polymarketAddress;
    if (wallet) {
      try {
        const live = await fetchUserPositions(wallet);
        for (const p of live) {
          // Only alert above a threshold — same cadence as the local scanner.
          if (Math.abs(p.percentPnl) < 25) continue;
          const dedupeCid = `live:${p.conditionId}:${Math.floor(p.percentPnl / 10)}`;
          if (st.alerts.some((a) => a.marketId === dedupeCid)) continue;

          const up = p.percentPnl >= 0;
          newAlerts.push({
            id: uuid(),
            createdAt: new Date().toISOString(),
            kind: up ? "take-profit" : "cut-loss",
            marketId: dedupeCid,
            marketName: p.eventTitle || p.outcome,
            outcome: p.outcome.toUpperCase() === "NO" ? "NO" : "YES",
            action: "SELL",
            priceLimit: clamp01(new Decimal(p.currentPrice).minus(0.01)),
            confidence: Math.min(95, Math.round(50 + Math.min(40, Math.abs(p.percentPnl) / 2))),
            rationale:
              `Live Polymarket: ${up ? "+" : ""}${p.percentPnl.toFixed(0)}% · ` +
              `$${p.cashPnl >= 0 ? "+" : ""}${p.cashPnl.toFixed(2)} on ${p.size.toFixed(2)} sh`,
            url: p.url,
          });
        }
      } catch { /* non-fatal */ }
    }

    // Scanner 5: Auto-fill PolyBot pending orders from on-chain /trades.
    // Matches trades we just discovered against our open orders so the user
    // doesn't have to manually mark them filled after executing on Polymarket.
    if (wallet && st.pendingOrders.some((o) => o.status === "open" || o.status === "partial")) {
      try {
        const trades = await fetchUserTrades(wallet, 200);
        const matches = matchTradesToOrders(st.pendingOrders, trades);
        for (const m of matches) {
          try {
            db.fillOrder(m.orderId, m.fillShares, m.fillPrice);
          } catch (e) { console.warn("auto-fill failed", e); }
        }
        if (matches.length > 0) {
          newAlerts.push({
            id: uuid(),
            createdAt: new Date().toISOString(),
            kind: "signal",
            marketId: "auto-fill",
            marketName: `${matches.length} pending order${matches.length === 1 ? "" : "s"} auto-filled`,
            outcome: "YES",
            action: "BUY",
            priceLimit: "0",
            confidence: 100,
            rationale: `Matched against your on-chain trades. Check Positions for updated state.`,
          });
        }
      } catch { /* non-fatal */ }
    }

    // Annotate every alert with a suggested share count + dollar amount so
    // the UI/notification body can show "buy ~2.5 sh · $0.45".
    const cashBalance = st.settings.cashBalance;
    for (const a of newAlerts) {
      const held = st.positions.find(
        (p) => p.marketId === a.marketId && p.outcome === a.outcome
      )?.shares;
      const sz = suggestSize({
        action: a.action,
        priceLimit: a.priceLimit,
        confidence: a.confidence,
        cashBalance,
        sharesHeld: held,
      });
      a.sizeShares = sz.shares;
      a.sizeDollars = sz.dollars;
      a.sizeNote = sz.reason;
    }

    saveSnap(next);
    db.addAlerts(newAlerts);
    db.setSettings({ lastCheckedAt: new Date().toISOString() });
    if (newAlerts.length > 0 && db.load().settings.notificationsEnabled) {
      void notifyAlerts(newAlerts).catch(() => { /* non-fatal */ });
    }
    lastStatus = `idle (${newAlerts.length} new)`;
  } catch (e) {
    lastStatus = `error: ${(e as Error).message}`.slice(0, 120);
  } finally {
    running = false;
    notify();
  }
}

function clamp01(d: Decimal): string {
  if (d.lessThan(0.01)) return "0.01";
  if (d.greaterThan(0.99)) return "0.99";
  return d.toDecimalPlaces(3).toString();
}

async function enrichWithClaude(
  alert: Alert, m: Market, mentions: number, spikePct: number, dp: number,
): Promise<void> {
  const sys = "You are a Polymarket assistant. Reply in STRICT JSON only: " +
    `{"action":"BUY"|"SELL","priceLimit":number(0..1),"confidence":number(0..100),"rationale":string(<=120 chars)}. ` +
    "No prose, no markdown.";
  const user =
    `Market: ${m.question} (id ${m.id}). Yes ${m.yesPrice}, No ${m.noPrice}. ` +
    `10-min Yes Δ=${dp.toFixed(1)}pp. Reddit mentions=${mentions} (spike ${spikePct.toFixed(0)}%). ` +
    `Recommend single best action for the next 60 minutes.`;
  try {
    const r = await askClaude(sys, [{ role: "user", content: user }], { maxTokens: 200, kind: "alert-enrich" });
    const parsed = JSON.parse(r.text.trim()) as {
      action?: string; priceLimit?: number; confidence?: number; rationale?: string;
    };
    const action: Alert["action"] = parsed.action === "SELL" ? "SELL" : "BUY";
    const patched: Alert = {
      ...alert,
      action,
      priceLimit: typeof parsed.priceLimit === "number"
        ? clamp01(new Decimal(parsed.priceLimit)) : alert.priceLimit,
      confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence ?? alert.confidence))),
      rationale: (parsed.rationale ?? alert.rationale).slice(0, 160),
    };
    // Replace the alert in storage (match by id).
    const s = db.load();
    s.alerts = s.alerts.map((a) => a.id === alert.id ? patched : a);
    db.save(s);
  } catch { /* keep heuristic alert as-is */ }
}
