import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart } from "recharts";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STRATEGIES, type BacktestResult } from "@/lib/engine";
import { pct, usd, signClass } from "@/lib/format";
import { MarketDataBadge, SimBadge } from "@/components/site/SiteChrome";
import type { MarketDataStatus } from "@/lib/market-status";

const SYMS = ["BTC-USD", "ETH-USD", "AAPL", "MSFT", "NVDA", "TSLA", "EUR-USD", "GOLD"] as const;
type Sym = (typeof SYMS)[number];

type Input = { symbol: Sym; strategy: (typeof STRATEGIES)[number]["id"]; startDate: string; endDate: string; capital: number };

export function BacktestPanel({ run }: { run: (i: Input) => Promise<Omit<BacktestResult, "trades"> & { trades: BacktestResult["trades"]; marketData?: MarketDataStatus }> }) {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [form, setForm] = useState<Input>({
    symbol: "BTC-USD", strategy: "ensemble",
    startDate: iso(new Date(today.getTime() - 365 * 86400000)), endDate: iso(today), capital: 10000,
  });
  const [res, setRes] = useState<Awaited<ReturnType<typeof run>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try { setRes(await run(form)); }
    catch (e) { const m = e instanceof Error ? e.message : "Backtest failed"; setErr(m); toast.error(m); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="glass space-y-4 rounded-xl p-5">
        <div className="space-y-2">
          <Label>Instrument</Label>
          <Select value={form.symbol} onValueChange={(v) => setForm({ ...form, symbol: v as Sym })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SYMS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Strategy</Label>
          <Select value={form.strategy} onValueChange={(v) => setForm({ ...form, strategy: v as Input["strategy"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STRATEGIES.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{STRATEGIES.find((s) => s.id === form.strategy)?.description}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>From</Label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
          <div className="space-y-2"><Label>To</Label><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
        </div>
        <div className="space-y-2">
          <Label>Starting virtual capital (USD)</Label>
          <Input type="number" min={100} value={form.capital} onChange={(e) => setForm({ ...form, capital: Number(e.target.value) })} />
        </div>
        <Button className="w-full bg-gradient-brand" onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run backtest
        </Button>
        <p className="text-[11px] text-muted-foreground">Long-only, next-bar-open fills, 0.1% fee per side, no leverage. Runs on stored daily candles; the data source is labelled on each result.</p>
      </div>

      <div className="glass min-h-[420px] rounded-xl p-5">
        {err && !res && <p className="text-sm text-destructive">{err}</p>}
        {!res && !err && (
          <div className="grid h-full min-h-[380px] place-items-center text-center text-sm text-muted-foreground">
            {busy ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : "Configure a test and press Run to see the simulated equity curve."}
          </div>
        )}
        {res && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Results</h3>
              <span className="flex flex-wrap items-center gap-2"><MarketDataBadge status={res.marketData} /><SimBadge label="Backtested · Simulated" /></span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ["Final equity", usd(res.finalEquity), 0],
                ["Total return", pct(res.totalReturnPct), res.totalReturnPct],
                ["Buy & hold", pct(res.buyHoldReturnPct), res.buyHoldReturnPct],
                ["Max drawdown", `-${res.maxDrawdownPct.toFixed(2)}%`, -1],
                ["Win rate", `${res.winRate.toFixed(1)}%`, 0],
                ["Trades", String(res.totalTrades), 0],
                ["Wins", String(res.wins), 1],
                ["Losses", String(res.losses), -1],
              ].map(([k, v, s]) => (
                <div key={k as string} className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">{k}</p>
                  <p className={`num mt-1 text-lg ${s ? signClass(s as number) : ""}`}>{v}</p>
                </div>
              ))}
            </div>
            <div className="h-64">
              <ResponsiveContainer>
                <ComposedChart data={res.equityCurve}>
                  <defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="ts" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} minTickGap={40} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={70} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                  <Area dataKey="equity" name="Strategy" stroke="var(--chart-1)" fill="url(#eq)" strokeWidth={2} />
                  <Line dataKey="benchmark" name="Buy & hold" stroke="var(--chart-2)" dot={false} strokeDasharray="4 4" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="h-32">
              <p className="mb-1 text-xs text-muted-foreground">Drawdown</p>
              <ResponsiveContainer>
                <AreaChart data={res.equityCurve}>
                  <XAxis dataKey="ts" hide />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={40} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                  <Area dataKey="drawdown" stroke="var(--destructive)" fill="var(--destructive)" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">Backtested results are hypothetical, computed on {res.marketData?.mode === "real" ? "historical provider data" : res.marketData?.mode === "simulated" ? "simulated historical data" : "stored historical data"}, and do not represent actual trading or guarantee future results.</p>
          </div>
        )}
      </div>
    </div>
  );
}
