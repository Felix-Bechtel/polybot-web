// PWA ↔ Cloudflare Worker push subscription flow.
//
// Flow:
//   1. User toggles "Background notifications" in Settings
//   2. We request notification permission (iOS requires standalone PWA)
//   3. We subscribe the service worker to push via VAPID public key
//   4. POST subscription JSON to the Worker — which stores + pushes
//
// The Worker URL is compiled in (free account subdomain). Override via
// VITE_PUSH_BACKEND env at build time if it moves.

const BACKEND = import.meta.env.VITE_PUSH_BACKEND ?? "https://polybot-push.felix-bechtel.workers.dev";
const VAPID_PUBLIC_KEY = "BHU7lfi43_azv35lW1qJ3wQPz7vtUYjZ9k8yK0py5zUwWk5PfUZfzgm-H-IRtBMzQm3rlzapdIf1CmG6y0wBtZc";

export interface BackendStatus {
  supported: boolean;
  subscribed: boolean;
  endpoint?: string;
  reason?: string;
}

function urlB64ToUint8Array(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Return whether this browser can handle Web Push. */
export async function currentStatus(): Promise<BackendStatus> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return { supported: false, subscribed: false, reason: "No service worker support" };
  }
  if (!("PushManager" in window)) {
    return { supported: false, subscribed: false, reason: "No PushManager support" };
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { supported: true, subscribed: false, reason: "Service worker not registered yet" };
    const sub = await reg.pushManager.getSubscription();
    return { supported: true, subscribed: !!sub, endpoint: sub?.endpoint };
  } catch (e) {
    return { supported: false, subscribed: false, reason: (e as Error).message };
  }
}

export interface LiveBalance {
  address: string;
  value: number | null;
  updatedAt: number | null;
  positions: Array<{
    conditionId: string;
    outcome: string;
    eventTitle: string;
    size: number;
    avgPrice: number;
    currentPrice: number;
    cashPnl: number;
    percentPnl: number;
    url: string;
  }>;
}

/** Fetch the Worker's cached balance + positions for a wallet. */
export async function fetchLiveBalance(address: string): Promise<LiveBalance | null> {
  try {
    const res = await fetch(`${BACKEND}/balance?user=${encodeURIComponent(address)}`);
    if (!res.ok) return null;
    return (await res.json()) as LiveBalance;
  } catch { return null; }
}

/** Subscribe the service worker to push and register with backend. */
export async function subscribeToPush(
  watchlist: string[],
  polymarketAddress?: string,
): Promise<BackendStatus> {
  if (Notification.permission === "default") {
    const p = await Notification.requestPermission();
    if (p !== "granted") return { supported: true, subscribed: false, reason: `permission ${p}` };
  }
  if (Notification.permission !== "granted") {
    return { supported: true, subscribed: false, reason: `permission ${Notification.permission}` };
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    // Pass through as a typed ArrayBuffer view for wide browser support.
    const keyBytes = urlB64ToUint8Array(VAPID_PUBLIC_KEY);
    // PushManager.subscribe types are overly strict w/ SharedArrayBuffer;
    // copy into a fresh ArrayBuffer for a guaranteed-safe BufferSource.
    const ab = new ArrayBuffer(keyBytes.byteLength);
    new Uint8Array(ab).set(keyBytes);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: ab,
    });
  }

  const res = await fetch(`${BACKEND}/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      watchlist,
      polymarketAddress,
    }),
  });
  if (!res.ok) {
    return { supported: true, subscribed: false, reason: `backend ${res.status}` };
  }
  return { supported: true, subscribed: true, endpoint: sub.endpoint };
}

export async function unsubscribeFromPush(): Promise<BackendStatus> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { supported: true, subscribed: false };
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { supported: true, subscribed: false };

  await fetch(`${BACKEND}/subscribe`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => { /* still unsub locally */ });

  await sub.unsubscribe();
  return { supported: true, subscribed: false };
}

/** Fire a one-off test push from the backend to every subscribed device. */
export async function triggerTestPush(): Promise<{ sent: number } | { error: string }> {
  try {
    const res = await fetch(`${BACKEND}/test-push`);
    if (!res.ok) return { error: `backend ${res.status}` };
    return (await res.json()) as { sent: number };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
