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
    <div className="flex flex-col h-full bg-canvas text-slate-100">
      <main className="flex-1 overflow-y-auto pt-safe pb-24">
        {tab === "dashboard" && <Dashboard onOpenMarkets={() => setTab("markets")} />}
        {tab === "markets"   && <Markets />}
        {tab === "portfolio" && <Portfolio />}
        {tab === "chat"      && <Chat />}
        {tab === "settings"  && <Settings />}
      </main>
      {/* Glassmorphism bottom nav — Stitch spec: no top border, backdrop blur, muted inactive */}
      <nav className="fixed bottom-0 left-0 w-full glass pb-safe grid grid-cols-5 z-50">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-col items-center py-3 transition-colors ${
                active ? "text-signal" : "text-slate-400"
              }`}
              aria-label={t.label}
            >
              <span className="text-xl leading-none">{t.icon}</span>
              <span className="text-[10px] font-semibold mt-1 uppercase tracking-wider">
                {t.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
