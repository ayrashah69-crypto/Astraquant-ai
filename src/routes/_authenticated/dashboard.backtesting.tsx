import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BacktestPanel } from "@/components/BacktestPanel";
import { Empty, ErrorState, Loading, PageTitle, Panel } from "@/components/dash/data";
import { SimBadge } from "@/components/site/SiteChrome";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listBacktests, runBacktest } from "@/lib/trading.functions";
import { STRATEGIES } from "@/lib/engine";
import { dt, pct, signClass, usd } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard/backtesting")({ component: BT });

function BT() {
  const run = useServerFn(runBacktest);
  const list = useServerFn(listBacktests);
  const qc = useQueryClient();
  const hist = useQuery({ queryKey: ["backtests"], queryFn: () => list() });
  return (
    <>
      <PageTitle title="Backtesting" subtitle="Runs are saved to your account." action={<SimBadge label="Backtested · Simulated" />} />
      <BacktestPanel run={async (data) => { const r = await run({ data }); qc.invalidateQueries({ queryKey: ["backtests"] }); return r; }} />
      <Panel title="Saved runs" className="mt-6">
        {hist.isLoading ? <Loading /> : hist.isError ? <ErrorState error={hist.error} retry={() => hist.refetch()} /> : !hist.data?.length ? <Empty title="No saved runs yet" /> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Symbol</TableHead><TableHead>Strategy</TableHead><TableHead>Range</TableHead><TableHead className="text-right">Capital</TableHead><TableHead className="text-right">Return</TableHead><TableHead className="text-right">Max DD</TableHead><TableHead className="text-right">Win rate</TableHead><TableHead className="text-right">Trades</TableHead><TableHead>Data</TableHead></TableRow></TableHeader>
            <TableBody>{hist.data.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs text-muted-foreground">{dt(r.created_at)}</TableCell>
                <TableCell>{r.symbol}</TableCell>
                <TableCell className="text-xs">{STRATEGIES.find((s) => s.id === r.strategy)?.name}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">{r.start_date} → {r.end_date}</TableCell>
                <TableCell className="num text-right">{usd(+r.starting_capital, 0)}</TableCell>
                <TableCell className={`num text-right ${signClass(+r.total_return_pct)}`}>{pct(+r.total_return_pct)}</TableCell>
                <TableCell className="num text-right text-destructive">-{(+r.max_drawdown_pct).toFixed(2)}%</TableCell>
                <TableCell className="num text-right">{(+r.win_rate).toFixed(1)}%</TableCell>
                <TableCell className="num text-right">{r.total_trades}</TableCell>
                <TableCell className="text-xs uppercase text-muted-foreground">{r.data_source === "simulated" ? "Simulated" : r.data_source}</TableCell>
              </TableRow>))}
            </TableBody>
          </Table></div>
        )}
      </Panel>
    </>
  );
}
