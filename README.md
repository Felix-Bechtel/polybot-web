# PolyBot — Web / PWA

> Local Polymarket simulator + Claude chat. **Installs on iPhone in 3 seconds** as a Progressive Web App — no Xcode, no Apple Developer account, no 7-day cert expiry, no App Store.
> Manual transaction entry only. No SMS. No auto-trading.

## One-paragraph summary

React + TypeScript + Vite single-page PWA. All currency math uses `decimal.js` initialized from **strings** (`new Decimal("1.15")`) — starting cash is exactly $1.15, the classic `0.1 + 0.2 = 0.30000000000000004` drift can't happen (covered by `money.test.ts` and `db.test.ts`). Persistence is `localStorage` via a pub/sub store. Claude is called direct from the browser with the `anthropic-dangerous-direct-browser-access: true` header — key lives only in your device's localStorage, never hits any server you don't own. Polymarket is read-only Gamma REST with an offline seed fallback.

## File tree

```
polybot-web/
├── package.json                      deps: react, decimal.js, vite, tailwind, vitest
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js / postcss.config.js
├── index.html                        iOS PWA meta + apple-touch-icon
├── public/
│   ├── manifest.webmanifest          PWA manifest (standalone)
│   ├── icon-192.png / icon-512.png
├── src/
│   ├── main.tsx / App.tsx            5-tab shell
│   ├── index.css                     Tailwind + iOS safe-area helpers
│   ├── seed.json                     5 bundled markets (offline fallback)
│   ├── lib/
│   │   ├── types.ts                  Market / Position / Transaction / UserSettings
│   │   ├── money.ts                  Decimal helpers — asUSD, asOdds, round2, normalizePrice
│   │   ├── db.ts                     localStorage store w/ recordBuy / recordSell / weighted avg
│   │   ├── useDB.ts                  React hook subscribing to db changes
│   │   ├── parser.ts                 Strict (sell)/(buy) + natural language + date
│   │   ├── claude.ts                 Browser-direct Anthropic client w/ retry+backoff
│   │   ├── polymarket.ts             Read-only Gamma REST + seed fallback
│   │   └── csv.ts                    Transactions CSV export
│   ├── components/
│   │   ├── Dashboard.tsx             Balance + equity + recent txns + search + Record button
│   │   ├── Markets.tsx               Browse/search markets, YES/NO pills
│   │   ├── MarketDetail.tsx          Order simulator + "Mirror on Polymarket" checklist
│   │   ├── Portfolio.tsx             Positions w/ live MTM, Buy-more / Sell buttons
│   │   ├── TransactionEntry.tsx      Modal form + review → Confirm flow
│   │   ├── Chat.tsx                  Local parse first, Claude fallback, Confirm buttons
│   │   └── Settings.tsx              API key / overdraft / CSV export / reset
│   └── __tests__/
│       ├── money.test.ts             6 tests — precision + rounding + formatting
│       ├── db.test.ts                6 tests — buy/sell/avg/overdraft/PnL
│       └── parser.test.ts            5 tests — strict + natural + cents norm + date + fail
```

## Run it locally

```bash
cd /Users/felixbechtel/polybot-web
npm install
npm run dev          # → http://localhost:5173  and  http://<your-LAN-ip>:5173
```

The dev server is already listening on **http://192.168.50.209:5173** from the last session.

## 📱 Install on your iPhone — 4 taps

Make sure your iPhone is on the **same Wi-Fi** as this Mac. Dev server must be running.

1. On iPhone Safari (must be Safari, not Chrome), open: **`http://192.168.50.209:5173`**
2. Tap the **Share** icon (the square with the arrow, bottom-center).
3. Scroll and tap **"Add to Home Screen"**.
4. Name it **PolyBot** → tap **Add**.

That's it — PolyBot is now a full-screen app icon on your home screen. No Xcode, no developer cert, no 7-day expiry. Launches like a native app.

### Heads-up on local Wi-Fi dev
- The URL is only reachable while the Mac is awake AND running `npm run dev`. If you want 24/7 access, **deploy** (see below) — takes 2 minutes.
- When you change your local IP (e.g. new coffee shop Wi-Fi), the old install keeps working *offline* for everything except live Polymarket prices and Claude.

## 🌐 Deploy permanently (2 min, free)

For a stable `https://yourname.vercel.app` that works from anywhere:

```bash
npm i -g vercel
vercel            # follow prompts — accept defaults
vercel --prod
```

Then install THAT URL to your home screen instead. Cloudflare Pages and Netlify work identically (drop `dist/` into their "deploy folder" UI after `npm run build`).

## Add Claude API key

Open the app → **Settings** tab → paste `sk-ant-…` → tap **Save to this device**.

Key is stored only in your browser's localStorage. It's sent directly to `https://api.anthropic.com/v1/messages` with the `anthropic-dangerous-direct-browser-access` header. Zero backend servers involved.

Without a key the bot still works — the local parser handles `(sell) Market Yes 10` and `"i bought 1 yes of POLY-BTC-100K at 0.42"` instantly.

## Example chat

```
You:    (sell) ClimatePolicyMarket Yes 10
Bot:    Sell 10.00 shares of 'YES' in ClimatePolicyMarket at 0.50 → proceeds $5.00.
        Confirm to record.                                 [Confirm]
You:    (tap Confirm)
Bot:    ✅ Recorded. New cash balance: $6.15.

You:    Record that I sold 5 shares of MarketX at $0.32 each on 2026-01-01
Bot:    Sell 5.00 shares of 'YES' in MarketX at 0.32 → proceeds $1.60.
        Confirm to record.                                 [Confirm]

You:    What's a good strategy for micro-stakes?     (no trade found → routed to Claude)
Bot:    (Claude response, under 240 chars, on-topic)
```

## QA checklist — $1.15 bug is dead

Run in the browser console (F12) or Safari dev tools after a fresh load:

- [ ] Dashboard shows **Cash balance: $1.15** exactly (never `$1.14`).
- [ ] `npm test` → **17/17 pass** (run in terminal).
- [ ] Record `i bought 1 yes of POLY-BTC-100K at 0.42` → Dashboard shows **$0.73**, exact.
- [ ] Sell 1 @ 0.50 → cash becomes exactly **$1.23**, realized P&L `$+0.20`.
- [ ] Overdraft toggle: OFF blocks BUY > cash; ON permits.

## QA checklist — no SMS, no auto-trading

- [ ] `grep -ri -E "twilio|sms|vonage|nexmo|messagebird" src/` → zero hits.
- [ ] `polymarket.ts` has **no POST**, no API key, no signing.
- [ ] Every trade-writing path requires `db.recordBuy` or `db.recordSell`, reachable only via:
  - `TransactionEntry.save()` after the **Confirm** button in the review card, or
  - `Chat.confirm(trade)` after the **Confirm** button in the chat bubble.

## Test commands

```bash
npm test             # 17/17 passing in ~1s
npm run test:watch   # TDD
npm run build        # prod build → dist/
```

## Next 3 improvements

1. **Claude tool-use** — give Claude real tools (`get_balance`, `record_buy`, …) and have the chat call them with confirm-first semantics. Scaffolded in `claude.ts`; plug in tool_use messages next.
2. **Service worker for offline** — cache the app shell + seed markets so PolyBot launches offline. 30 lines of `vite-plugin-pwa`.
3. **IndexedDB + CloudKit-style sync** — swap localStorage for Dexie.js, then add a tiny signed-sync option over a free Worker. Keeps portfolio in sync between Mac and iPhone.

## ETA

~12–18 developer hours for a polished v1 from here: Claude tool-use (4h), service-worker offline (2h), iPad + landscape polish (2h), share-sheet CSV import (2h), dark/light theme toggle (1h), end-to-end QA (3h).
