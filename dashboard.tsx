import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Activity, BarChart3, BrainCircuit, FlaskConical, History, KeyRound, LayoutDashboard, LogOut, Menu, Settings, ShieldAlert, Wallet, X, CandlestickChart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/site/SiteChrome";
import { useDashboard } from "@/components/dash/data";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — AstraQuant AI" }, { name: "robots", content: "noindex" }] }),
  component: DashLayout,
});

const NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/dashboard/markets", label: "Markets", icon: CandlestickChart },
  { to: "/dashboard/signals", label: "AI Signals", icon: BrainCircuit },
  { to: "/dashboard/backtesting", label: "Backtesting", icon: FlaskConical },
  { to: "/dashboard/paper-trading", label: "Paper Trading", icon: Activity },
  { to: "/dashboard/portfolio", label: "Portfolio", icon: Wallet },
  { to: "/dashboard/trades", label: "Trade History", icon: History },
  { to: "/dashboard/risk", label: "Risk Monitor", icon: ShieldAlert },
  { to: "/dashboard/license", label: "License", icon: KeyRound },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

function DashLayout() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { data } = useDashboard();
  const signOut = async () => { await supabase.auth.signOut(); nav({ to: "/login" }); };
  const side = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-4"><Logo /><button className="md:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
      <nav className="flex-1 space-y-0.5 px-2">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} activeOptions={{ exact: "exact" in n }} onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            activeProps={{ className: "bg-sidebar-accent text-foreground" }}>
            <n.icon className="h-4 w-4" />{n.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-2 border-t border-sidebar-border p-3">
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
          <p className="text-muted-foreground">License</p>
          <p className="font-medium uppercase">{data?.license ? `${data.license.plan} · active` : data ? "none active" : "…"}</p>
        </div>
        <button onClick={signOut} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"><LogOut className="h-4 w-4" />Sign out</button>
      </div>
    </div>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-sidebar-border bg-sidebar/80 backdrop-blur md:block">{side}</aside>
      {open && <div className="fixed inset-0 z-50 md:hidden"><div className="absolute inset-0 bg-background/70" onClick={() => setOpen(false)} /><aside className="relative h-full w-64 bg-sidebar">{side}</aside></div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/70 px-4 backdrop-blur md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><BarChart3 className="h-3 w-3" />Paper mode</span>
        </header>
        <div className={`border-b px-4 py-1.5 text-center text-[11px] ${data?.marketData.state === "unavailable" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-warning/20 bg-warning/5 text-warning"}`}>
          Paper-trading mode · virtual capital · {data ? data.marketData.label : "checking market data…"} · no real orders are sent
          {data?.marketData.state === "unavailable" && <> — {data.marketData.detail} Positions are valued at cost until data returns.</>}
        </div>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8"><Outlet /></main>
      </div>
    </div>
  );
}
