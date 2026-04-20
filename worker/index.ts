// PolyBot push Worker
//
// Two cron jobs in one tick (runs every 10 min):
//   A) Opportunity scanner — Polymarket + Reddit, emits value-based alerts
//   B) Account tracker — for each subscriber with a linked wallet, polls
//      data-api.polymarket.com and emits alerts for balance/position changes
//
// HTTP:
//   POST   /subscribe   { subscription, polymarketAddress?, watchlist? }
//   DELETE /subscribe   { endpoint }
//   GET    /balance?user=0x…   — live balance + positions snapshot from KV
//   GET    /test-push   — fire a one-off test notification to all subs
//   GET    /health
//
// KV layout:
//   sub:<hash>                 → SubRecord (subscription + metadata)
//   watchlist                  → default watchlist[] (fallback if sub lacks one)
//   dedupe:<hashKey>           → "1" with 1h TTL
//   market:<id>                → { p, v } last-tick market snapshot (6h TTL)
//   acct:<addr>:value          → { value, at } last-tick wallet value (6h)
//   acct:<addr>:positions      → map conditionId → { size, avgPrice, title, url } (6h)

import { buildVapidAuthHeader } from "./vapid";

export interface Env {
  POLYBOT_KV: KVNamespace;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
interface SubRecord {
  subscription: PushSubscriptionJSON;
  polymarketAddress?: string;     // 0x… lowercase
  watchlist?: string[];
  subscribedAt: number;           // epoch ms
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/health") {
      return json({ ok: true, at: new Date().toISOString() });
    }

    if (url.pathname === "/subscribe" && req.method === "POST") {
      const body = (await req.json().catch(() => null)) as {
        subscription?: PushSubscriptionJSON;
        polymarketAddress?: string;
        watchlist?: string[];
      } | null;
      if (!body?.subscription?.endpoint) return json({ error: "missing subscription" }, 400);
      const addr = body.polymarketAddress?.toLowerCase();
      if (addr && !/^0x[a-f0-9]{40}$/.test(addr)) return json({ error: "bad address" }, 400);
      const record: SubRecord = {
        subscription: body.subscription,
        polymarketAddress: addr,
        watchlist: body.watchlist,
        subscribedAt: Date.now(),
      };
      const key = "sub:" + await hashEndpoint(body.subscription.endpoint);
      await env.POLYBOT_KV.put(key, JSON.stringify(record));
      return json({ ok: true, key });
    }

    if (url.pathname === "/subscribe" && req.method === "DELETE") {
      const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
      if (!body?.endpoint) return json({ error: "missing endpoint" }, 400);
      await env.POLYBOT_KV.delete("sub:" + await hashEndpoint(body.endpoint));
      return json({ ok: true });
    }

    if (url.pathname === "/balance") {
      const addr = url.searchParams.get("user")?.toLowerCase();
      if (!addr || !/^0x[a-f0-9]{40}$/.test(addr)) return json({ error: "bad address" }, 400);
      const value = await env.POLYBOT_KV.get(`acct:${addr}:value`, "json")
                     as { value: number; at: number } | null;
      const positions = await env.POLYBOT_KV.get(`acct:${addr}:positions`, "json")
                     as Record<string, AccountPosition> | null;
      return json({
        address: addr,
        value: value?.value ?? null,
        updatedAt: value?.at ?? null,
        positions: positions ? Object.values(positions) : [],
      });
    }

    if (url.pathname === "/test-push") {
      const sent = await pushAll(env, {
        title: "✅ PolyBot test push",
        body: "Backend is live. Real alerts arrive the same way, even with the app closed.",
      });
      return json({ sent });
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    try { await opportunityScan(env); }
    catch (e) { console.error("opportunityScan failed", e); }
    try { await accountTracker(env); }
    catch (e) { console.error("accountTracker failed", e); }
  },
};

// ─── A) Opportunity scanner (same as before, trimmed) ───────────────────

interface MarketLite {
  id: string;
  question: string;
  yesPrice: number;
  volume24h: number;
  eventSlug?: string;
}

async function fetchTopMarkets(limit = 150): Promise<MarketLite[]> {
  try {
    const url = `https://gamma-api.polymarket.com/markets?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const arr = (await res.json()) as Array<Record<string, unknown>>;
    return arr.map((m) => {
      const id = (m.conditionId ?? m.id ?? m.slug) as string | undefined;
      if (!id) return null;
      const rawPrices = m.outcomePrices ?? m.outcome_prices;
      let prices: unknown = rawPrices;
      if (typeof prices === "string") { try { prices = JSON.parse(prices); } catch { prices = null; } }
      const yes = Array.isArray(prices) ? parseFloat(String(prices[0] ?? "0.5")) : 0.5;
      const events = (m.events as Array<{ slug?: string }> | undefined) ?? [];
      return {
        id: String(id),
        question: (m.question as string) ?? "",
        yesPrice: yes,
        volume24h: parseFloat(String(m.volume24hr ?? 0)),
        eventSlug: events[0]?.slug,
      };
    }).filter((m): m is MarketLite => m != null);
  } catch { return []; }
}

async function opportunityScan(env: Env): Promise<void> {
  const top = await fetchTopMarkets(150);
  const alerts: OutgoingAlert[] = [];

  for (const m of top) {
    if (!(m.volume24h >= 5_000)) continue;
    const cheapBuy = m.yesPrice >= 0.10 && m.yesPrice <= 0.60;
    const nearWin  = m.yesPrice >= 0.62 && m.yesPrice <= 0.92;
    if (!cheapBuy && !nearWin) continue;

    const prev = await env.POLYBOT_KV.get<{ p: number; v: number }>(`market:${m.id}`, "json");
    await env.POLYBOT_KV.put(`market:${m.id}`, JSON.stringify({ p: m.yesPrice, v: m.volume24h }), {
      expirationTtl: 60 * 60 * 6,
    });
    if (!prev) continue;
    const dp = (m.yesPrice - prev.p) * 100;
    if (Math.abs(dp) < 0.5) continue;

    const action = dp >= 0 ? "BUY" : "SELL";
    const outcome = dp >= 0 ? "YES" : "NO";
    const confidence = Math.min(90, Math.round(40 + Math.min(40, Math.abs(dp) * 4) + Math.log10(m.volume24h + 1) * 4));
    const url = m.eventSlug
      ? `https://polymarket.com/event/${m.eventSlug}`
      : `https://polymarket.com/markets?q=${encodeURIComponent(m.question.slice(0, 80))}`;

    alerts.push({
      title: `${action} ${outcome} · ${truncate(m.question, 42)}`,
      body: `${(m.yesPrice * 100).toFixed(0)}¢ · ${dp >= 0 ? "+" : ""}${dp.toFixed(1)}pp · ${confidence}% conf`,
      url,
      dedupeKey: `opp:${m.id}:${Math.floor(Date.now() / (60 * 60 * 1000))}`,
    });
  }

  const novel = await dedupeAlerts(env, alerts);
  if (novel.length === 0) return;
  await pushAll(env, ...novel.slice(0, 5));
}

// ─── B) Account tracker — per subscriber with linked wallet ─────────────

interface AccountPosition {
  conditionId: string;
  outcome: string;
  eventTitle: string;
  eventSlug?: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  cashPnl: number;
  percentPnl: number;
  url: string;
}

async function accountTracker(env: Env): Promise<void> {
  const list = await env.POLYBOT_KV.list({ prefix: "sub:" });
  const seen = new Set<string>();

  for (const { name } of list.keys) {
    const raw = await env.POLYBOT_KV.get(name);
    if (!raw) continue;
    const rec = JSON.parse(raw) as SubRecord;
    const addr = rec.polymarketAddress;
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    try { await trackAccount(env, addr, rec.subscription); }
    catch (e) { console.error("trackAccount failed for", addr, e); }
  }
}

async function trackAccount(env: Env, addr: string, sub: PushSubscriptionJSON): Promise<void> {
  const [valueArr, positions] = await Promise.all([
    fetchJSON<Array<{ user: string; value: number }>>(`https://data-api.polymarket.com/value?user=${addr}`),
    fetchJSON<Array<Record<string, unknown>>>(`https://data-api.polymarket.com/positions?user=${addr}&sizeThreshold=0.01`),
  ]);
  const liveValue = valueArr?.[0]?.value ?? 0;

  // Snapshot previous state.
  const prevValue = await env.POLYBOT_KV.get<{ value: number; at: number }>(`acct:${addr}:value`, "json");
  const prevPositions = (await env.POLYBOT_KV.get<Record<string, AccountPosition>>(`acct:${addr}:positions`, "json")) ?? {};

  // Parse current positions into a normalized map.
  const currentPositions: Record<string, AccountPosition> = {};
  for (const p of positions ?? []) {
    const conditionId = (p.conditionId ?? p.condition_id) as string | undefined;
    if (!conditionId) continue;
    const size = Number(p.size ?? 0);
    if (!(size > 0)) continue;
    const eventSlug = String(p.eventSlug ?? "");
    const outcome = String(p.outcome ?? "");
    const eventTitle = String(p.title ?? p.eventTitle ?? "");
    const slug = eventSlug || (p.slug as string | undefined) || "";
    const url = slug
      ? `https://polymarket.com/event/${slug}`
      : `https://polymarket.com/markets?q=${encodeURIComponent(eventTitle.slice(0, 80))}`;
    currentPositions[conditionId] = {
      conditionId,
      outcome,
      eventTitle,
      eventSlug: slug || undefined,
      size,
      avgPrice: Number(p.avgPrice ?? 0),
      currentPrice: Number(p.curPrice ?? p.currentPrice ?? p.price ?? 0),
      cashPnl: Number(p.cashPnl ?? 0),
      percentPnl: Number(p.percentPnl ?? 0),
      url,
    };
  }

  // Persist fresh snapshots (6h TTL).
  await env.POLYBOT_KV.put(`acct:${addr}:value`, JSON.stringify({ value: liveValue, at: Date.now() }), {
    expirationTtl: 60 * 60 * 6,
  });
  await env.POLYBOT_KV.put(`acct:${addr}:positions`, JSON.stringify(currentPositions), {
    expirationTtl: 60 * 60 * 6,
  });

  const alerts: OutgoingAlert[] = [];

  // 1) Value swing — only alert when change ≥ $0.50 AND ≥ 5%.
  if (prevValue) {
    const delta = liveValue - prevValue.value;
    const pct = prevValue.value > 0 ? (delta / prevValue.value) * 100 : 0;
    if (Math.abs(delta) >= 0.50 && Math.abs(pct) >= 5) {
      const arrow = delta >= 0 ? "▲" : "▼";
      alerts.push({
        title: `${arrow} Account $${liveValue.toFixed(2)}`,
        body: `${delta >= 0 ? "+" : ""}$${delta.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%) from $${prevValue.value.toFixed(2)}`,
        dedupeKey: `val:${addr}:${Math.floor(Date.now() / (30 * 60 * 1000))}`, // per 30min
      });
    }
  }

  // 2) New position — something appeared this tick
  for (const [cid, p] of Object.entries(currentPositions)) {
    if (prevPositions[cid]) continue;
    alerts.push({
      title: `➕ New position · ${p.outcome}`,
      body: `${p.size.toFixed(2)} sh @ $${p.avgPrice.toFixed(3)} · ${truncate(p.eventTitle, 50)}`,
      url: p.url,
      dedupeKey: `new:${addr}:${cid}`,
    });
  }

  // 3) Position exit — something disappeared
  for (const cid of Object.keys(prevPositions)) {
    if (currentPositions[cid]) continue;
    const p = prevPositions[cid];
    alerts.push({
      title: `➖ Closed · ${p.outcome}`,
      body: `Exited ${p.size.toFixed(2)} sh in ${truncate(p.eventTitle, 50)}`,
      url: p.url,
      dedupeKey: `exit:${addr}:${cid}`,
    });
  }

  // 4) Big P&L swings on active positions — at least ±25% from avg
  for (const [cid, p] of Object.entries(currentPositions)) {
    const prev = prevPositions[cid];
    if (!prev) continue;
    if (Math.abs(p.percentPnl) < 25) continue;
    const dedupeBucket = Math.floor(p.percentPnl / 10); // only alert when ±10% bucket shifts
    const prevBucket = Math.floor(prev.percentPnl / 10);
    if (dedupeBucket === prevBucket) continue;
    const emoji = p.percentPnl >= 0 ? "💰" : "⚠️";
    alerts.push({
      title: `${emoji} ${p.percentPnl >= 0 ? "Up" : "Down"} ${Math.abs(p.percentPnl).toFixed(0)}%`,
      body: `${p.outcome} in ${truncate(p.eventTitle, 50)} · $${p.cashPnl >= 0 ? "+" : ""}${p.cashPnl.toFixed(2)}`,
      url: p.url,
      dedupeKey: `pnl:${addr}:${cid}:${dedupeBucket}`,
    });
  }

  const novel = await dedupeAlerts(env, alerts);
  if (novel.length === 0) return;

  // Push ONLY to this subscriber (account-specific alerts).
  for (const a of novel.slice(0, 5)) {
    try { await sendWebPush(env, sub, a); } catch (e) { console.error(e); }
  }
}

// ─── Push infrastructure ────────────────────────────────────────────────

interface OutgoingAlert {
  title: string;
  body: string;
  url?: string;
  dedupeKey: string;
}

async function dedupeAlerts(env: Env, alerts: OutgoingAlert[]): Promise<OutgoingAlert[]> {
  const out: OutgoingAlert[] = [];
  for (const a of alerts) {
    const seen = await env.POLYBOT_KV.get(`dedupe:${a.dedupeKey}`);
    if (seen) continue;
    await env.POLYBOT_KV.put(`dedupe:${a.dedupeKey}`, "1", { expirationTtl: 60 * 60 });
    out.push(a);
  }
  return out;
}

async function pushAll(env: Env, ...alerts: Array<{ title: string; body: string; url?: string }>): Promise<number> {
  const list = await env.POLYBOT_KV.list({ prefix: "sub:" });
  let count = 0;
  for (const { name } of list.keys) {
    const raw = await env.POLYBOT_KV.get(name);
    if (!raw) continue;
    let sub: PushSubscriptionJSON | undefined;
    try {
      const rec = JSON.parse(raw) as SubRecord | PushSubscriptionJSON;
      sub = (rec as SubRecord).subscription ?? (rec as PushSubscriptionJSON);
    } catch { continue; }
    if (!sub?.endpoint) continue;
    for (const a of alerts) {
      try { if (await sendWebPush(env, sub, a)) count++; }
      catch (e) { console.error(e); }
    }
  }
  return count;
}

async function sendWebPush(env: Env, sub: PushSubscriptionJSON,
                           payload: { title: string; body: string; url?: string }): Promise<boolean> {
  const aud = new URL(sub.endpoint).origin;
  const jwt = await buildVapidAuthHeader(aud, env.VAPID_SUBJECT, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);
  const body = JSON.stringify(payload);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${jwt.token}, k=${env.VAPID_PUBLIC_KEY}`,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "3600",
    },
    body: await encryptPayload(body, sub.keys.p256dh, sub.keys.auth),
  });
  if (res.status === 404 || res.status === 410) {
    await env.POLYBOT_KV.delete("sub:" + await hashEndpoint(sub.endpoint));
  }
  return res.ok;
}

async function fetchJSON<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

async function hashEndpoint(endpoint: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function encryptPayload(plaintext: string, p256dhB64: string, authB64: string): Promise<ArrayBuffer> {
  const p256dh = b64urlDecode(p256dhB64);
  const authSecret = b64urlDecode(authB64);
  const ephKey = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ephPubRaw = await crypto.subtle.exportKey("raw", ephKey.publicKey);
  const ephPubBytes = new Uint8Array(ephPubRaw);
  const recipientKey = await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: recipientKey }, ephKey.privateKey, 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prkKey = await hkdfExtract(authSecret, new Uint8Array(sharedSecret));
  const keyInfo = concat(new TextEncoder().encode("WebPush: info\0"), p256dh, ephPubBytes);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const padded = concat(new TextEncoder().encode(plaintext), new Uint8Array([0x02]));
  const cekKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, padded);
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + ephPubBytes.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = ephPubBytes.length;
  header.set(ephPubBytes, 21);
  return concat(header, new Uint8Array(ct)).buffer;
}

async function hkdfExtract(salt: BufferSource, ikm: BufferSource): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", key, ikm);
}
async function hkdfExpand(prk: BufferSource, info: BufferSource, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const infoBytes = new Uint8Array(info as ArrayBuffer);
  const t1 = new Uint8Array(await crypto.subtle.sign("HMAC", key, concat(infoBytes, new Uint8Array([1]))));
  return t1.slice(0, length);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}
function json(v: unknown, status = 200): Response {
  return new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
