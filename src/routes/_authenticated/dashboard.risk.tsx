import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ErrorState, Loading, PageTitle, Panel, Stat, useDashboard } from "@/components/dash/data";

export const Route = createFileRoute("/_authenticated/dashboard/risk")({ component: Risk });

function Risk() {
  const q = useDashboard();
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { risk, positions, portfolio, profile } = q.data;
  const maxPct = +(profile?.max_position_pct ?? 25);
  return (
    <>
      <PageTitle title="Risk Monitor" subtitle="Exposure, concentration and volatility checks on your virtual account." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Status" value={risk.status} tone={risk.status === "NORMAL" ? "text-success" : risk.status === "CAUTION" ? "text-warning" : "text-destructive"} />
        <Stat label="Gross exposure" value={`${risk.exposurePct.toFixed(1)}%`} />
        <Stat label="Largest position" value={`${risk.largestPct.toFixed(1)}%`} sub={`Limit ${maxPct}%`} />
        <Stat label="Portfolio daily vol" value={`${(risk.weightedVol * 100).toFixed(2)}%`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Alerts">
          {risk.alerts.length ? risk.alerts.map((a) => <p key={a} className="mb-2 flex items-start gap-2 text-sm text-warning"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{a}</p>)
            : <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" />All risk checks within limits.</p>}
          <p className="mt-4 text-xs text-muted-foreground">Risk per trade: {profile?.risk_per_trade ?? 2}% of equity · Max position: {maxPct}%. <Link to="/dashboard/settings" className="text-primary">Adjust</Link></p>
        </Panel>
        <Panel title="Concentration">
          {positions.length ? positions.map((p) => {
            const w = (p.value / portfolio.equity) * 100;
            return (
              <div key={p.id} className="mb-3">
                <div className="mb-1 flex justify-between text-xs"><span>{p.symbol}</span><span className={`num ${w > maxPct ? "text-warning" : ""}`}>{w.toFixed(1)}% · vol {(p.volatility * 100).toFixed(2)}%</span></div>
                <Progress value={Math.min(100, w)} />
              </div>
            );
          }) : <p className="text-sm text-muted-foreground">No positions — account is fully in cash.</p>}
        </Panel>
      </div>
    </>
  );
}
