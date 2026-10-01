import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Menu, X, Orbit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { quoteFreshness, type MarketDataStatus } from "@/lib/market-status";
import { dt } from "@/lib/format";

const NAV = [
  { to: "/platform", label: "Platform" },
  { to: "/ai-engine", label: "AI Engine" },
  { to: "/backtesting", label: "Backtesting" },
  { to: "/pricing", label: "Pricing" },
] as const;

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand text-primary-foreground shadow-glow">
        <Orbit className="h-4 w-4" />
      </span>
      <span>AstraQuant <span className="text-gradient">AI</span></span>
    </Link>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Logo />
        <nav className="hidden items-center gap-6 md:flex">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className="text-sm text-muted-foreground transition-colors hover:text-foreground" activeProps={{ className: "text-foreground" }}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {user ? (
            <Button asChild><Link to="/dashboard">Open dashboard</Link></Button>
          ) : (
            <>
              <Button variant="ghost" asChild><Link to="/login">Sign in</Link></Button>
              <Button asChild className="bg-gradient-brand"><Link to="/register">Start demo</Link></Button>
            </>
          )}
        </div>
        <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu">
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <div className="space-y-1 border-t border-border px-4 py-3 md:hidden">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} onClick={() => setOpen(false)} className="block rounded-md px-2 py-2 text-sm hover:bg-muted">{n.label}</Link>
          ))}
          <Link to={user ? "/dashboard" : "/login"} onClick={() => setOpen(false)} className="block rounded-md px-2 py-2 text-sm text-primary">
            {user ? "Dashboard" : "Sign in"}
          </Link>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 md:grid-cols-4">
        <div className="space-y-3 md:col-span-2">
          <Logo />
          <p className="max-w-md text-sm text-muted-foreground">
            Intelligent Market Analysis. Automated Decision Systems.
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            AstraQuant AI is analysis and simulation software. It does not execute real-money trades and does not provide
            financial advice. All backtested and paper-trading results are simulated and do not guarantee future performance.
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-medium">Product</p>
          {NAV.map((n) => <Link key={n.to} to={n.to} className="block text-muted-foreground hover:text-foreground">{n.label}</Link>)}
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-medium">Account</p>
          <Link to="/login" className="block text-muted-foreground hover:text-foreground">Sign in</Link>
          <Link to="/register" className="block text-muted-foreground hover:text-foreground">Create account</Link>
        </div>
      </div>
      <p className="border-t border-border py-4 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} AstraQuant AI</p>
    </footer>
  );
}

export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function PageHero({ eyebrow, title, subtitle }: { eyebrow: string; title: ReactNode; subtitle: string }) {
  return (
    <section className="mx-auto max-w-4xl px-4 pb-10 pt-16 text-center md:pt-24">
      <p className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-primary">{eyebrow}</p>
      <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">{title}</h1>
      <p className="mx-auto mt-5 max-w-2xl text-muted-foreground md:text-lg">{subtitle}</p>
    </section>
  );
}

// Says whether prices are REAL provider data, SIMULATED demo data, or currently unavailable.
// Uses the server-computed label so simulated and real data never share wording.
export function MarketDataBadge({ status }: { status?: MarketDataStatus | null }) {
  if (!status) return null;
  const tone = status.state === "unavailable"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : status.mode === "real" ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning";
  return (
    <span title={status.detail} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>
      {status.label}
    </span>
  );
}

// Small honest note under a price: only shown when the quote is not simply current. The timestamp is
// the provider's own quote time, so a cached or after-hours price is never presented as fresh.
export function FreshnessNote({ q }: { q: { marketOpen: boolean | null; stale: boolean; asOf: string; source: string } }) {
  if (q.source !== "real") return null;
  const f = quoteFreshness(q);
  if (f === "fresh") return null;
  return <span className={`text-[10px] ${f === "delayed" ? "text-warning" : "text-muted-foreground"}`}>{f === "closed" ? "Market closed" : "Delayed"} · as of {dt(q.asOf)}</span>;
}

export function SimBadge({ label = "SIMULATED" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
      {label}
    </span>
  );
}
