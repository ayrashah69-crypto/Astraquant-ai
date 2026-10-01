import { createFileRoute } from "@tanstack/react-router";
import { ErrorState, Loading, PageTitle, Panel, Stat, useDashboard } from "@/components/dash/data";
import { TradesTable } from "@/components/dash/widgets";
import { signClass, usd } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard/trades")({ component: Trades });

function Trades() {
  const q = useDashboard();
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const t = q.data.trades;
  const sells = t.filter((x) => x.side === "SELL");
  const wins = sells.filter((x) => +x.realized_pnl > 0).length;
  const fees = t.reduce((a, x) => a + +x.notional * 0.001, 0);
  const realized = t.reduce((a, x) => a + +x.realized_pnl, 0);
  return (
    <>
      <PageTitle title="Trade History" subtitle="Every simulated fill recorded by the paper broker (latest 200)." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Trades" value={t.length} />
        <Stat label="Closed win rate" value={sells.length ? `${((wins / sells.length) * 100).toFixed(1)}%` : "—"} sub={`${wins}/${sells.length} sells profitable`} />
        <Stat label="Realised P/L (net)" value={usd(realized)} tone={signClass(realized)} />
        <Stat label="Fees paid" value={usd(fees)} />
      </div>
      <Panel><TradesTable trades={t} /></Panel>
    </>
  );
}
