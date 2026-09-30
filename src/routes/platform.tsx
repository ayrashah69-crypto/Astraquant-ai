import { createFileRoute, Link } from "@tanstack/react-router";
import { Database, Server, Cpu, Wallet, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero, PublicPage } from "@/components/site/SiteChrome";

export const Route = createFileRoute("/platform")({
  head: () => ({
    meta: [
      { title: "Platform — AstraQuant AI" },
      { name: "description", content: "How AstraQuant AI connects market data, strategy analysis, risk and paper execution." },
      { property: "og:title", content: "Platform — AstraQuant AI" },
      { property: "og:description", content: "The architecture behind AstraQuant AI's analysis and paper-trading platform." },
    ],
  }),
  component: Platform,
});

const LAYERS = [
  { icon: Database, title: "Market data layer", body: "Daily candles stored in the database and a current quote, supplied by a server-side provider adapter (or, only when explicitly enabled for demos, a clearly labelled simulated feed). Swapping vendors does not change the rest of the system." },
  { icon: Cpu, title: "Strategy & analysis engine", body: "Computes EMA, RSI, breakout levels, momentum and volatility, then runs EMA Cross, RSI Reversion, Momentum Breakout or an Ensemble vote." },
  { icon: Server, title: "Server functions", body: "Signals, license checks, backtests and trades all execute on the server. The browser only displays results." },
  { icon: Wallet, title: "Paper execution", body: "A virtual broker fills orders at the current market-data price, charges a 0.1% fee and keeps exact cash, cost basis and realised P/L." },
  { icon: Plug, title: "Broker integration layer (future)", body: "A clean adapter interface where a regulated broker could be added — only after security testing and compliance review. Not active today." },
];

function Platform() {
  return (
    <PublicPage>
      <PageHero eyebrow="Platform" title={<>A complete <span className="text-gradient">decision system</span></>} subtitle="Five layers, each with a single responsibility, so every number you see can be traced back to its source." />
      <section className="mx-auto max-w-4xl space-y-4 px-4 pb-20">
        {LAYERS.map((l, i) => (
          <div key={l.title} className="glass flex gap-5 rounded-xl p-6">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-muted text-primary"><l.icon className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Layer {i + 1}</p>
              <h3 className="font-medium">{l.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{l.body}</p>
            </div>
          </div>
        ))}
        <div className="pt-6 text-center"><Button className="bg-gradient-brand" asChild><Link to="/register">Explore it with a demo account</Link></Button></div>
      </section>
    </PublicPage>
  );
}
