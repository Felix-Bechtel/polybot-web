import { useState } from "react";
import Dashboard from "./components/Dashboard";
import Markets from "./components/Markets";
import Portfolio from "./components/Portfolio";
import Chat from "./components/Chat";
import Settings from "./components/Settings";

type Tab = "dashboard" | "markets" | "portfolio" | "chat" | "settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "dashboard", label: "Home",      icon: "🏠" },
  { id: "markets",   label: "Markets",   icon: "📈" },
  { id: "portfolio", label: "Positions", icon: "💼" },
  { id: "chat",      label: "Chat",      icon: "💬" },
  { id: "settings",  label: "Settings",  icon: "⚙️" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100">
      <main className="flex-1 overflow-y-auto pt-safe">
        {tab === "dashboard" && <Dashboard onOpenMarkets={() => setTab("markets")} />}
        {tab === "markets"   && <Markets />}
        {tab === "portfolio" && <Portfolio />}
        {tab === "chat"      && <Chat />}
        {tab === "settings"  && <Settings />}
      </main>
      <nav className="grid grid-cols-5 border-t border-slate-800 bg-slate-900/90 backdrop-blur pb-safe">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`py-2 flex flex-col items-center text-xs transition-colors ${
              tab === t.id ? "text-sky-400" : "text-slate-400"
            }`}
            aria-label={t.label}
          >
            <span className="text-lg">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
