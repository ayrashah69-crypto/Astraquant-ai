import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ComposedChart, Line, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, LineChart, ReferenceLine } from "recharts";
import { getCandles } from "@/lib/trading.functions";
import { ErrorState, Loading, PageTitle, Panel, useDashboard } from "@/components/dash/data";
import { MarketList, type Sym } from "@/components/dash/widgets";
import { MarketDataBadge } from "@/components/site/SiteChrome";
import { price } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard/markets")({ component: Markets });

function Markets() {
  const dash = useDashboard();
  const [symbol, setSymbol] = useState<Sym>("BTC-USD");
  const [days, setDays] = useState(120);
  const fn = useServerFn(getCandles);
  const c = useQuery({ queryKey: ["candles", symbol, days], queryFn: () => fn({ data: { symbol, days } }) });
  const last = c.data?.at(-1);
  return (
    <>
      <PageTitle title="Markets" subtitle="Daily candles with EMA trend lines and RSI." action={<MarketDataBadge status={dash.data?.marketData} />} />
      {dash.data && <p className="-mt-4 mb-4 text-xs text-muted-foreground">{dash.data.marketData.detail}</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Panel title={<span className="flex items-center gap-3">{symbol}{last && <span className="num text-muted-foreground">{price(last.close)}</span>}</span>}
          action={<div className="flex gap-1">{[60, 120, 250, 500].map((d) => <button key={d} onClick={() => setDays(d)} className={`rounded px-2 py-1 text-xs ${days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{d}d</button>)}</div>}>
          {c.isLoading ? <Loading /> : c.isError ? <ErrorState error={c.error} retry={() => c.refetch()} /> : (
            <>
              <div className="h-80">
                <ResponsiveContainer>
                  <ComposedChart data={c.data ?? []}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="ts" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} minTickGap={40} />
                    <YAxis yAxisId="p" domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={70} />
                    <YAxis yAxisId="v" orientation="right" hide />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                    <Bar yAxisId="v" dataKey="volume" fill="var(--muted)" opacity={0.6} />
                    <Line yAxisId="p" dataKey="close" stroke="var(--foreground)" dot={false} strokeWidth={1.5} />
                    <Line yAxisId="p" dataKey="emaFast" name="EMA 12" stroke="var(--chart-1)" dot={false} />
                    <Line yAxisId="p" dataKey="emaSlow" name="EMA 26" stroke="var(--chart-2)" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 h-28">
                <p className="text-xs text-muted-foreground">RSI (14)</p>
                <ResponsiveContainer>
                  <LineChart data={c.data ?? []}>
                    <XAxis dataKey="ts" hide /><YAxis domain={[0, 100]} ticks={[30, 70]} width={30} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <ReferenceLine y={70} stroke="var(--destructive)" strokeDasharray="3 3" /><ReferenceLine y={30} stroke="var(--success)" strokeDasharray="3 3" />
                    <Line dataKey="rsi" stroke="var(--chart-4)" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Panel>
        <Panel title="Watchlist">{dash.data ? <MarketList quotes={dash.data.quotes} unavailable={dash.data.unavailable} onPick={(s) => setSymbol(s as Sym)} /> : <Loading />}</Panel>
      </div>
    </>
  );
}
