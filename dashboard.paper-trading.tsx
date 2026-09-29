import { createFileRoute } from "@tanstack/react-router";
import { ErrorState, Loading, PageTitle, Panel, Stat, useDashboard } from "@/components/dash/data";
import { MarketList, PositionsTable, TradeTicket, TradesTable } from "@/components/dash/widgets";
import { signClass, usd } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard/paper-trading")({ component: Paper });

function Paper() {
  const q = useDashboard();
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  return (
    <>
      <PageTitle title="Paper Trading" subtitle="Orders fill instantly at the current market-data price with virtual money." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cash" value={usd(d.portfolio.cash)} />
        <Stat label="Equity" value={usd(d.portfolio.equity)} />
        <Stat label="Realised P/L" value={usd(d.portfolio.realized)} tone={signClass(d.portfolio.realized)} />
        <Stat label="Unrealised P/L" value={usd(d.portfolio.unrealized)} tone={signClass(d.portfolio.unrealized)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Panel title="Order ticket"><TradeTicket quotes={d.quotes} positions={d.positions} /></Panel>
          <Panel title="Quotes"><MarketList quotes={d.quotes} unavailable={d.unavailable} /></Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Open positions"><PositionsTable positions={d.positions} /></Panel>
          <Panel title="Latest fills"><TradesTable trades={d.trades} limit={10} /></Panel>
        </div>
      </div>
    </>
  );
}
