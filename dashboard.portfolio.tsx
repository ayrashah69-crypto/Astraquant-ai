import { createFileRoute } from "@tanstack/react-router";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Empty, ErrorState, Loading, PageTitle, Panel, Stat, useDashboard } from "@/components/dash/data";
import { EquityChart, PositionsTable } from "@/components/dash/widgets";
import { pct, signClass, usd } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard/portfolio")({ component: Portfolio });

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function Portfolio() {
  const q = useDashboard();
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const alloc = [{ name: "Cash", value: d.portfolio.cash }, ...d.positions.map((p) => ({ name: p.symbol, value: p.value }))];
  return (
    <>
      <PageTitle title="Portfolio" subtitle="Virtual holdings valued at current market-data prices." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Equity" value={usd(d.portfolio.equity)} />
        <Stat label="Total simulated P/L" value={usd(d.portfolio.totalPnl)} sub={pct(d.portfolio.totalPnlPct)} tone={signClass(d.portfolio.totalPnl)} />
        <Stat label="Invested" value={usd(d.portfolio.invested)} />
        <Stat label="Cash" value={usd(d.portfolio.cash)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Equity history" className="lg:col-span-2"><EquityChart data={d.history} height={280} /></Panel>
        <Panel title="Allocation">
          {alloc.length ? (
            <div className="h-64"><ResponsiveContainer><PieChart>
              <Pie data={alloc} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} stroke="none">{alloc.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie>
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} formatter={(v: number) => usd(v)} />
            </PieChart></ResponsiveContainer></div>
          ) : <Empty title="Nothing allocated" />}
          <div className="space-y-1 text-xs">{alloc.map((a, i) => <div key={a.name} className="flex justify-between"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{a.name}</span><span className="num">{((a.value / d.portfolio.equity) * 100).toFixed(1)}%</span></div>)}</div>
        </Panel>
      </div>
      <Panel title="Positions" className="mt-4"><PositionsTable positions={d.positions} /></Panel>
    </>
  );
}
