import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ErrorState, Loading, PageTitle, Panel, Stat, useDashboard, Empty } from "@/components/dash/data";
import { EquityChart, MarketList, PositionsTable, SignalCard, TradesTable } from "@/components/dash/widgets";
import { pct, signClass, usd } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard/")({ component: Overview });

function Overview() {
  const q = useDashboard();
  if (q.isLoading) return <Loading label="Loading your workspace…" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const riskTone = d.risk.status === "NORMAL" ? "text-success" : d.risk.status === "CAUTION" ? "text-warning" : "text-destructive";
  return (
    <>
      <PageTitle title={`Welcome${d.profile?.display_name ? `, ${d.profile.display_name}` : ""}`} subtitle="Your simulated trading account at a glance." action={<Button asChild className="bg-gradient-brand"><Link to="/dashboard/signals">Generate signal</Link></Button>} />
      {!d.license && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">No active license — signals and trading are locked. <Link to="/dashboard/license" className="underline">Manage license</Link></div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Virtual cash" value={usd(d.portfolio.cash)} />
        <Stat label="Equity" value={usd(d.portfolio.equity)} sub={`Start ${usd(d.portfolio.start, 0)}`} />
        <Stat label="Simulated P/L" value={usd(d.portfolio.totalPnl)} sub={pct(d.portfolio.totalPnlPct)} tone={signClass(d.portfolio.totalPnl)} />
        <Stat label="Open positions" value={d.positions.length} sub={`${usd(d.portfolio.invested, 0)} invested`} />
        <Stat label="Risk status" value={d.risk.status} tone={riskTone} sub={`${d.risk.exposurePct.toFixed(1)}% exposure`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Performance (simulated)" className="lg:col-span-2"><EquityChart data={d.history} /></Panel>
        <Panel title="Market overview" action={<Link to="/dashboard/markets" className="text-xs text-primary">All</Link>}><MarketList quotes={d.quotes} unavailable={d.unavailable} /></Panel>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Open positions" className="lg:col-span-2"><PositionsTable positions={d.positions} /></Panel>
        <Panel title="AI analysis" action={<Link to="/dashboard/signals" className="text-xs text-primary">All</Link>}>
          {d.signals.length ? <div className="space-y-2">{d.signals.slice(0, 3).map((s) => <SignalCard key={s.id} s={s} compact />)}</div> : <Empty title="No signals yet"><Link to="/dashboard/signals" className="mt-1 text-primary">Run the engine</Link></Empty>}
        </Panel>
      </div>
      <Panel title="Recent trades" className="mt-4" action={<Link to="/dashboard/trades" className="text-xs text-primary">History</Link>}><TradesTable trades={d.trades} limit={6} /></Panel>
    </>
  );
}
