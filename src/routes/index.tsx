import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Activity, BrainCircuit, FlaskConical, LineChart, Lock, ShieldCheck, Wallet, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { FreshnessNote, MarketDataBadge, PublicPage } from "@/components/site/SiteChrome";
import { getPublicMarkets } from "@/lib/trading.functions";
import { pct, price, signClass } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AstraQuant AI — Intelligent Market Analysis" },
      { name: "description", content: "Analyze markets, generate rule-based signals, backtest strategies and paper trade with virtual capital." },
      { property: "og:title", content: "AstraQuant AI — Intelligent Market Analysis" },
      { property: "og:description", content: "Signals, backtesting and paper trading in one platform. No real-money execution." },
    ],
  }),
  component: Home,
});

const PIPE = ["Market Data", "Features", "Strategy", "BUY / SELL / HOLD", "Confidence", "Risk Check", "Paper Trade"];

const FAQ = [
  ["Does AstraQuant AI trade real money?", "No. Execution is limited to a paper-trading engine with virtual capital. Live broker connectivity is deliberately not enabled."],
  ["Does the AI guarantee profit?", "No. Signals are statistical heuristics computed from historical prices. They can be wrong, and past behaviour does not predict future results."],
  ["Where does the market data come from?", "Prices come from a server-side market-data layer. The badge above the market preview states whether this deployment is showing REAL MARKET DATA from a configured provider (timing and coverage depend on that provider's plan) or SIMULATED MARKET DATA generated for demos. If real data is unavailable the app says so instead of substituting simulated prices."],
  ["What do I get with the demo?", "A 14-day demo license, a $100,000 virtual account, AI signals, backtesting and full paper trading."],
];

function Home() {
  const markets = useQuery({ queryKey: ["public-markets"], queryFn: () => getPublicMarkets(), refetchInterval: 60_000 });
  return (
    <PublicPage>
      <section className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 md:pt-28">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="mx-auto max-w-4xl text-center">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> Paper trading only · No real-money execution
          </p>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            Intelligent Market Analysis.<br /><span className="text-gradient">Automated Decision Systems.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            AstraQuant AI turns price data into transparent BUY / SELL / HOLD signals, stress-tests strategies on history,
            and lets you rehearse them with virtual capital.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" className="bg-gradient-brand shadow-glow" asChild><Link to="/register">Start free demo <ArrowRight className="h-4 w-4" /></Link></Button>
            <Button size="lg" variant="outline" asChild><Link to="/backtesting">Try the backtester</Link></Button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.7 }} className="glass mx-auto mt-16 max-w-5xl rounded-2xl p-4 shadow-glow">
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="text-sm font-medium">Market analytics preview</p>
            <MarketDataBadge status={markets.data?.marketData} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {markets.isLoading && Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/50" />)}
            {markets.isError && <p className="col-span-full p-4 text-sm text-destructive">Market preview unavailable right now.</p>}
            {markets.data && !markets.data.quotes.length && <p className="col-span-full p-4 text-sm text-muted-foreground">{markets.data.marketData.detail}</p>}
            {markets.data?.quotes.map((q) => (
              <div key={q.symbol} className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">{q.symbol}</p>
                <p className="num mt-1 text-lg">{price(q.price)}</p>
                <p className={`num text-xs ${signClass(q.changePct)}`}>{pct(q.changePct)}</p>
                <FreshnessNote q={q} />
              </div>
            ))}
            {markets.data?.unavailable.map((u) => (
              <div key={u.symbol} title={u.message} className="rounded-lg border border-dashed border-border bg-background/20 p-3">
                <p className="text-xs text-muted-foreground">{u.symbol}</p>
                <p className="mt-1 text-sm text-muted-foreground">Unavailable</p>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16">
        <h2 className="text-3xl font-semibold tracking-tight">One workflow, end to end</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">From raw prices to a risk-checked virtual order — every step is visible and auditable.</p>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            [LineChart, "Market analytics", "Candles, EMA trend lines, RSI and volatility for eight instruments across crypto, equities, FX and metals."],
            [BrainCircuit, "AI signal engine", "Four rule-based strategies, including an ensemble vote, output an action and a confidence score."],
            [FlaskConical, "Backtesting", "Replay strategies on history with fees, drawdown and win/loss stats. Always labelled as simulated."],
            [Wallet, "Paper trading", "A virtual $100k account with real position, cost basis and P/L accounting."],
            [Activity, "Risk monitor", "Position sizing from your risk budget, exposure limits and volatility alerts."],
            [Lock, "License management", "Server-issued license keys verified on every protected action."],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof LineChart;
            return (
              <div key={t as string} className="glass rounded-xl p-6 transition-transform hover:-translate-y-1">
                <I className="h-6 w-6 text-primary" />
                <h3 className="mt-4 font-medium">{t as string}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{d as string}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16">
        <div className="glass rounded-2xl p-8 md:p-12">
          <p className="text-xs uppercase tracking-[0.25em] text-primary">AI engine overview</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Transparent decisions, not black boxes</h2>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            {PIPE.map((p, i) => (
              <div key={p} className="flex items-center gap-2">
                <span className="rounded-lg border border-border bg-background/50 px-3 py-2 text-sm">{p}</span>
                {i < PIPE.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="outline" asChild><Link to="/ai-engine">How the engine works</Link></Button>
            <Button variant="ghost" asChild><Link to="/backtesting">Backtesting preview →</Link></Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-16 md:grid-cols-2">
        <div>
          <ShieldCheck className="h-8 w-8 text-primary" />
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">Security by design</h2>
          <p className="mt-3 text-muted-foreground">Built so that nothing risky happens by accident.</p>
        </div>
        <ul className="space-y-3 text-sm">
          {[
            "Every account's data is isolated with row-level access rules in the database.",
            "Trades, signals and licenses are written only by server functions — never directly by the browser.",
            "No broker keys or secrets are ever sent to the browser.",
            "Live-money execution is isolated behind an adapter that is not enabled.",
          ].map((t) => <li key={t} className="glass rounded-lg p-4">{t}</li>)}
        </ul>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-16">
        <h2 className="mb-6 text-3xl font-semibold tracking-tight">FAQ</h2>
        <Accordion type="single" collapsible>
          {FAQ.map(([q = "", a]) => (
            <AccordionItem key={q} value={q}><AccordionTrigger>{q}</AccordionTrigger><AccordionContent className="text-muted-foreground">{a}</AccordionContent></AccordionItem>
          ))}
        </Accordion>
      </section>
    </PublicPage>
  );
}
