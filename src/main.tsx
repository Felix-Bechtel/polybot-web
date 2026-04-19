import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { db } from "./lib/db";
import { start as startScheduler } from "./lib/scheduler";

// Register the service worker. Required for iOS PWA push notifications.
// BASE_URL is injected by Vite (e.g. "/polybot-web/") so SW scope matches the
// GitHub Pages subpath and the PWA install works correctly.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    navigator.serviceWorker
      .register(`${base}/sw.js`, { scope: `${base}/` })
      .catch(() => { /* non-fatal */ });
  });
}

// Auto-resume the 10-min poller if it was ON before the last reload.
if (db.load().settings.alertsEnabled) {
  startScheduler();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
