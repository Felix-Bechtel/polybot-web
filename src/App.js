import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import Dashboard from "./components/Dashboard";
import Markets from "./components/Markets";
import Portfolio from "./components/Portfolio";
import Chat from "./components/Chat";
import Settings from "./components/Settings";
const TABS = [
    { id: "dashboard", label: "Home", icon: "🏠" },
    { id: "markets", label: "Markets", icon: "📈" },
    { id: "portfolio", label: "Positions", icon: "💼" },
    { id: "chat", label: "Chat", icon: "💬" },
    { id: "settings", label: "Settings", icon: "⚙️" },
];
export default function App() {
    const [tab, setTab] = useState("dashboard");
    return (_jsxs("div", { className: "flex flex-col h-full bg-slate-950 text-slate-100", children: [_jsxs("main", { className: "flex-1 overflow-y-auto pt-safe", children: [tab === "dashboard" && _jsx(Dashboard, { onOpenMarkets: () => setTab("markets") }), tab === "markets" && _jsx(Markets, {}), tab === "portfolio" && _jsx(Portfolio, {}), tab === "chat" && _jsx(Chat, {}), tab === "settings" && _jsx(Settings, {})] }), _jsx("nav", { className: "grid grid-cols-5 border-t border-slate-800 bg-slate-900/90 backdrop-blur pb-safe", children: TABS.map((t) => (_jsxs("button", { onClick: () => setTab(t.id), className: `py-2 flex flex-col items-center text-xs transition-colors ${tab === t.id ? "text-sky-400" : "text-slate-400"}`, "aria-label": t.label, children: [_jsx("span", { className: "text-lg", children: t.icon }), _jsx("span", { children: t.label })] }, t.id))) })] }));
}
