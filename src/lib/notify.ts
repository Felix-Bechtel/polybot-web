// Browser/system notifications for new alerts.
//
// iOS note: system notifications only work when the PWA is INSTALLED to the
// Home Screen (Safari ≥16.4). Before install, permission will be "denied"
// silently — we also surface an in-app fallback so the user still sees alerts.

import { Alert } from "./types";

const DISPATCHED_KEY = "polybot.notify.dispatched.v1";

function loadDispatched(): Set<string> {
  try {
    const raw = localStorage.getItem(DISPATCHED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}
function saveDispatched(s: Set<string>): void {
  // cap at 500 to keep localStorage bounded
  const arr = Array.from(s).slice(-500);
  localStorage.setItem(DISPATCHED_KEY, JSON.stringify(arr));
}

export type NotifPermissionState = "granted" | "denied" | "default" | "unsupported";

export function getNotificationPermission(): NotifPermissionState {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export interface NotifDiagnostics {
  secureContext: boolean;           // HTTPS or localhost
  serviceWorker: "unsupported" | "not-registered" | "registered";
  permission: NotifPermissionState;
  standalone: boolean;              // running as installed PWA
}

export async function getDiagnostics(): Promise<NotifDiagnostics> {
  const secureContext = typeof window !== "undefined" && window.isSecureContext === true;
  let sw: NotifDiagnostics["serviceWorker"] = "unsupported";
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      sw = reg ? "registered" : "not-registered";
    } catch { sw = "not-registered"; }
  }
  let standalone = false;
  if (typeof window !== "undefined") {
    // iOS
    // @ts-expect-error non-standard Safari property
    if (navigator.standalone) standalone = true;
    if (window.matchMedia?.("(display-mode: standalone)").matches) standalone = true;
  }
  return { secureContext, serviceWorker: sw, permission: getNotificationPermission(), standalone };
}

/** Fire a single test notification so the user can verify end-to-end. */
export async function sendTestNotification(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof Notification === "undefined") return { ok: false, reason: "Notifications not supported" };
  if (Notification.permission !== "granted") {
    const p = await ensureNotificationPermission();
    if (p !== "granted") return { ok: false, reason: `Permission ${p}` };
  }
  let reg: ServiceWorkerRegistration | null = null;
  if ("serviceWorker" in navigator) {
    try { reg = (await navigator.serviceWorker.getRegistration()) ?? null; } catch {}
  }
  const title = "✅ PolyBot test notification";
  const opts: NotificationOptions = {
    body: "If you see this on your iPhone, real alerts will too.",
    tag: "polybot:test",
    icon: `${import.meta.env.BASE_URL}icon-192.png`,
    badge: `${import.meta.env.BASE_URL}icon-192.png`,
  };
  try {
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); }
    else { new Notification(title, opts); }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Ask the user once. Returns the granted status. */
export async function ensureNotificationPermission(): Promise<NotifPermissionState> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    const p = await Notification.requestPermission();
    return p;
  } catch { return Notification.permission; }
}

function titleFor(a: Alert): string {
  switch (a.kind) {
    case "opportunity": return `💎 Opportunity · ${a.marketName.slice(0, 40)}`;
    case "take-profit": return `💰 Take profit · ${a.marketName.slice(0, 40)}`;
    case "cut-loss":    return `⚠️ Cut loss · ${a.marketName.slice(0, 40)}`;
    default:            return `${a.action} ${a.outcome} · ${a.marketName.slice(0, 40)}`;
  }
}

function bodyFor(a: Alert): string {
  const size = a.sizeShares && a.sizeDollars
    ? `\n👉 ~${a.sizeShares} sh · $${a.sizeDollars}`
    : "";
  return `${a.action} ${a.outcome} @ ≤${a.priceLimit} · conf ${a.confidence}%${size}\n${a.rationale}`;
}

/** Fire system notifications for each alert, dedupe across reloads.
 *
 * Strategy:
 *   - Prefer ServiceWorkerRegistration.showNotification (required on iOS PWA)
 *   - Fall back to new Notification() on desktop browsers without a SW
 */
export async function notifyAlerts(alerts: Alert[]): Promise<void> {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  const dispatched = loadDispatched();
  const fresh = alerts.filter((a) => !dispatched.has(a.id));
  if (fresh.length === 0) return;

  let reg: ServiceWorkerRegistration | null = null;
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try { reg = (await navigator.serviceWorker.getRegistration()) ?? null; } catch { reg = null; }
  }

  for (const a of fresh) {
    const title = titleFor(a);
    const opts: NotificationOptions = {
      body: bodyFor(a),
      tag: `polybot:${a.marketId}:${a.kind}`,
      data: { url: a.url, alertId: a.id },
      icon: `${import.meta.env.BASE_URL}icon-192.png`,
      badge: `${import.meta.env.BASE_URL}icon-192.png`,
    };
    try {
      if (reg && reg.showNotification) {
        await reg.showNotification(title, opts);
      } else {
        const n = new Notification(title, opts);
        if (a.url) n.onclick = () => { try { window.open(a.url, "_blank"); } catch {} };
      }
      dispatched.add(a.id);
    } catch { /* ignore per-alert errors */ }
  }
  saveDispatched(dispatched);
}
