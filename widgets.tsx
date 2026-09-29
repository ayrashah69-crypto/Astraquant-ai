import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { executePaperTrade, generateSignal, previewPaperTrade } from "@/lib/trading.functions";
import { STRATEGIES } from "@/lib/engine";
import { dt, pct, price, qty, signClass, usd } from "@/lib/format";
import { Empty, useDashboard, useRefreshDashboard, type Dashboard } from "./data";
import { FreshnessNote, SimBadge } from "@/components/site/SiteChrome";

export const SYMS = ["BTC-USD", "ETH-USD", "AAPL", "MSFT", "NVDA", "TSLA", "EUR-USD", "GOLD"] as const;
export type Sym = (typeof SYMS)[number];

export function EquityChart({ data, height = 240 }: { data: Dashboard["history"]; height?: number }) {
  if (data.length < 3) return <Empty title="No performance history yet">Place a paper trade to start tracking equity.</Empty>;
  const rows = data.map((d) => ({ ...d, label: dt(d.ts) }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={rows}>
          <defs><linearGradient id="dq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} minTickGap={40} />
          <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={70} domain={["auto", "auto"]} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} formatter={(v: number) => usd(v)} />
          <Area dataKey="equity" stroke="var(--chart-1)" fill="url(#dq)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PositionsTable({ positions }: { positions: Dashboard["positions"] }) {
  if (!positions.length) return <Empty title="No open positions">Use Paper Trading or an AI signal to open one.</Empty>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Avg</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="text-right">Unrealised</TableHead></TableRow></TableHeader>
        <TableBody>
          {positions.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.symbol}</TableCell>
              <TableCell className="num text-right">{qty(p.quantity)}</TableCell>
              <TableCell className="num text-right">{price(p.avg_price)}</TableCell>
              <TableCell className="num text-right">{price(p.price)}</TableCell>
              <TableCell className="num text-right">{usd(p.value)}</TableCell>
              <TableCell className={`num text-right ${signClass(p.unrealized)}`}>{usd(p.unrealized)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function TradesTable({ trades, limit }: { trades: Dashboard["trades"]; limit?: number }) {
  const rows = limit ? trades.slice(0, limit) : trades;
  if (!rows.length) return <Empty title="No trades yet" />;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Symbol</TableHead><TableHead>Side</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Notional</TableHead><TableHead className="text-right">Realised P/L</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dt(t.executed_at)}</TableCell>
              <TableCell className="font-medium">{t.symbol}</TableCell>
              <TableCell className={t.side === "BUY" ? "text-success" : "text-destructive"}>{t.side}</TableCell>
              <TableCell className="num text-right">{qty(+t.quantity)}</TableCell>
              <TableCell className="num text-right">{price(+t.price)}</TableCell>
              <TableCell className="num text-right">{usd(+t.notional)}</TableCell>
              <TableCell className={`num text-right ${signClass(+t.realized_pnl)}`}>{usd(+t.realized_pnl)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{t.source === "ai_signal" ? "AI signal" : "Manual"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function MarketList({ quotes, unavailable = [], onPick }: { quotes: Dashboard["quotes"]; unavailable?: Dashboard["unavailable"]; onPick?: (s: string) => void }) {
  return (
    <div className="divide-y divide-border">
      {quotes.map((q) => (
        <button key={q.symbol} onClick={() => onPick?.(q.symbol)} title={`Quote time: ${q.asOf}`} className="flex w-full items-center justify-between py-2.5 text-left hover:bg-muted/30">
          <span className="text-sm font-medium">{q.symbol}</span>
          <span className="flex flex-col items-end">
            <span className="flex items-center gap-4">
              <span className="num text-sm">{price(q.price)}</span>
              <span className={`num w-16 text-right text-xs ${signClass(q.changePct)}`}>{pct(q.changePct)}</span>
            </span>
            <FreshnessNote q={q} />
          </span>
        </button>
      ))}
      {unavailable.map((u) => (
        <div key={u.symbol} title={u.message} className="flex w-full items-center justify-between py-2.5 text-muted-foreground">
          <span className="text-sm font-medium">{u.symbol}</span>
          <span className="text-xs">Unavailable</span>
        </div>
      ))}
    </div>
  );
}

type Signal = Dashboard["signals"][number];

export function SignalCard({ s, compact }: { s: Signal; compact?: boolean }) {
  const exec = useServerFn(executePaperTrade);
  const refresh = useRefreshDashboard();
  const [busy, setBusy] = useState(false);
  const risk = s.risk_check as { passed: boolean; reasons: string[]; suggestedQty: number; stopLoss: number; riskLevel: string };
  const tone = s.action === "BUY" ? "text-success border-success/40 bg-success/10" : s.action === "SELL" ? "text-destructive border-destructive/40 bg-destructive/10" : "text-muted-foreground border-border bg-muted/40";
  const run = async () => {
    setBusy(true);
    try {
      const r = await exec({ data: { symbol: s.symbol as Sym, side: s.action as "BUY" | "SELL", quantity: risk.suggestedQty, signalId: s.id } });
      toast.success(`Paper ${s.action} filled at ${price(r.price)}`);
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Trade failed"); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${tone}`}>{s.action}</span>
          <span className="font-medium">{s.symbol}</span>
        </div>
        <span className="num text-sm">{Math.round(+s.confidence * 100)}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-gradient-brand" style={{ width: `${+s.confidence * 100}%` }} /></div>
      <p className="mt-2 text-xs text-muted-foreground">{STRATEGIES.find((x) => x.id === s.strategy)?.name} · {price(+s.price)} · {dt(s.created_at)}</p>
      {!compact && <p className="mt-2 text-xs text-muted-foreground">{s.rationale}</p>}
      {!compact && (
        <div className="mt-3 rounded-md border border-border p-2 text-xs">
          <p>Risk check: <span className={risk.passed ? "text-success" : "text-warning"}>{risk.passed ? "PASSED" : "BLOCKED"}</span> · Risk {risk.riskLevel}</p>
          {risk.passed ? <p className="text-muted-foreground">Suggested size {qty(risk.suggestedQty)} · stop {price(risk.stopLoss)}</p> : risk.reasons.map((r) => <p key={r} className="text-muted-foreground">• {r}</p>)}
        </div>
      )}
      {!compact && risk.passed && s.action !== "HOLD" && (
        <Button size="sm" className="mt-3 w-full" onClick={run} disabled={busy}>{busy && <Loader2 className="h-3 w-3 animate-spin" />}Send to paper broker</Button>
      )}
    </div>
  );
}

export function SignalGenerator({ onDone }: { onDone?: () => void }) {
  const gen = useServerFn(generateSignal);
  const refresh = useRefreshDashboard();
  const [symbol, setSymbol] = useState<Sym>("BTC-USD");
  const [strategy, setStrategy] = useState<(typeof STRATEGIES)[number]["id"]>("ensemble");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const s = await gen({ data: { symbol, strategy } }); toast.success(`${s.action} ${s.symbol} · ${Math.round(+s.confidence * 100)}% confidence`); refresh(); onDone?.(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Signal failed"); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      <div className="flex-1 space-y-1"><Label className="text-xs">Instrument</Label>
        <Select value={symbol} onValueChange={(v) => setSymbol(v as Sym)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SYMS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="flex-1 space-y-1"><Label className="text-xs">Strategy</Label>
        <Select value={strategy} onValueChange={(v) => setStrategy(v as typeof strategy)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STRATEGIES.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
      </div>
      <Button className="bg-gradient-brand" onClick={run} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Analyze</Button>
    </div>
  );
}

export function TradeTicket({ quotes, positions, defaultSymbol = "BTC-USD" }: { quotes: Dashboard["quotes"]; positions: Dashboard["positions"]; defaultSymbol?: string }) {
  const exec = useServerFn(executePaperTrade);
  const previewFn = useServerFn(previewPaperTrade);
  const refresh = useRefreshDashboard();
  const md = useDashboard().data?.marketData;
  const priceLabel = md?.state === "ok" ? (md.mode === "real" ? "Price (provider quote)" : "Price (simulated)") : "Price";
  const [symbol, setSymbol] = useState<Sym>(defaultSymbol as Sym);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewFn>> | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const requestId = useRef(0);
  const q = quotes.find((x) => x.symbol === symbol);
  const held = positions.find((p) => p.symbol === symbol)?.quantity ?? 0;
  const n = Number(amount);
  const key = `${symbol}|${side}|${n}`;

  // Ask the server whether this order would currently pass risk limits — debounced so
  // we don't fire a request on every keystroke, and only once a valid quantity exists.
  // This is a preview only; executePaperTrade() below re-validates everything itself
  // regardless of what this returns.
  useEffect(() => {
    if (!(n > 0) || !Number.isFinite(n)) {
      setPreview(null);
      setPreviewKey(null);
      setChecking(false);
      return;
    }
    const id = ++requestId.current;
    setChecking(true);
    const t = setTimeout(() => {
      previewFn({ data: { symbol, side, quantity: n } })
        .then((r) => {
          if (requestId.current !== id) return;
          setPreview(r);
          setPreviewKey(key);
        })
        .catch(() => {
          if (requestId.current !== id) return;
          setPreview(null);
          setPreviewKey(null);
        })
        .finally(() => {
          if (requestId.current === id) setChecking(false);
        });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, side, n]);

  const previewCurrent = preview && previewKey === key ? preview : null;
  const blocked = previewCurrent ? !previewCurrent.allowed : false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(n > 0)) { toast.error("Enter a quantity greater than zero"); return; }
    if (blocked) { toast.error("This order would be blocked by your risk limits"); return; }
    setBusy(true);
    try {
      const r = await exec({ data: { symbol, side, quantity: n } });
      toast.success(`${side} ${qty(n)} ${symbol} @ ${price(r.price)}`);
      refresh();
      setPreview(null);
      setPreviewKey(null);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Trade failed"); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center justify-between"><SimBadge label="Paper order" /><span className="text-xs text-muted-foreground">Fee 0.1%</span></div>
      <div className="grid grid-cols-2 gap-2">
        {(["BUY", "SELL"] as const).map((s) => (
          <button type="button" key={s} onClick={() => setSide(s)} className={`rounded-md border py-2 text-sm font-medium ${side === s ? (s === "BUY" ? "border-success bg-success/15 text-success" : "border-destructive bg-destructive/15 text-destructive") : "border-border text-muted-foreground"}`}>{s}</button>
        ))}
      </div>
      <div className="space-y-1"><Label className="text-xs">Instrument</Label>
        <Select value={symbol} onValueChange={(v) => setSymbol(v as Sym)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SYMS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="space-y-1"><Label className="text-xs">Quantity</Label><Input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="space-y-1 rounded-md bg-muted/40 p-3 text-xs">
        <div className="flex justify-between"><span className="text-muted-foreground">{priceLabel}</span><span className="num">{q ? price(q.price) : "—"}</span></div>
        {q && <div className="flex justify-end"><FreshnessNote q={q} /></div>}
        <div className="flex justify-between"><span className="text-muted-foreground">Est. notional</span><span className="num">{q && n > 0 ? usd(q.price * n) : "—"}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Currently held</span><span className="num">{qty(held)}</span></div>
      </div>
      {n > 0 && (
        <div className={`rounded-md border p-2 text-xs ${previewCurrent ? (previewCurrent.allowed ? "border-success/40 text-success" : "border-warning/40 text-warning") : "border-border text-muted-foreground"}`}>
          {previewCurrent ? (
            <>
              <p className="flex items-center gap-1.5">
                {previewCurrent.allowed ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                Risk check: <span className="font-medium">{previewCurrent.allowed ? "PASSED" : "BLOCKED"}</span> · Risk {previewCurrent.riskLevel}
              </p>
              {previewCurrent.allowed
                ? <p className="mt-1 text-muted-foreground">Est. fee {usd(previewCurrent.estimatedFee)} · stop {price(previewCurrent.stopLoss)}</p>
                : previewCurrent.reasons.map((r) => <p key={r} className="mt-1 text-muted-foreground">• {r}</p>)}
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-muted-foreground">{checking && <Loader2 className="h-3 w-3 animate-spin" />}{checking ? "Checking risk limits…" : "Risk check pending — will run on submit."}</p>
          )}
        </div>
      )}
      <Button className="w-full" disabled={busy || !(n > 0) || blocked}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Place paper {side.toLowerCase()}</Button>
    </form>
  );
}
