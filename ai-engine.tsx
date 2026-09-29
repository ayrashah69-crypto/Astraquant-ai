import { createFileRoute } from "@tanstack/react-router";
import { PageHero, PublicPage } from "@/components/site/SiteChrome";
import { STRATEGIES } from "@/lib/engine";

export const Route = createFileRoute("/ai-engine")({
  head: () => ({
    meta: [
      { title: "AI Engine — AstraQuant AI" },
      { name: "description", content: "Market data, feature processing, strategy analysis, signal generation and risk analysis explained." },
      { property: "og:title", content: "AI Engine — AstraQuant AI" },
      { property: "og:description", content: "How AstraQuant AI turns prices into risk-checked BUY / SELL / HOLD signals." },
    ],
  }),
  component: Engine,
});

const STAGES = [
  ["01", "Market data", "Up to 500 daily OHLCV candles per instrument, with the current quote appended as the latest bar."],
  ["02", "Feature processing", "EMA(12), EMA(26), RSI(14), 20-bar high, 10-bar low, 10-bar momentum and 20-bar realised volatility."],
  ["03", "Strategy analysis", "The selected strategy evaluates the latest two feature bars. The ensemble weighs all three and a trend-state tiebreaker."],
  ["04", "Signal generation", "Outputs BUY, SELL or HOLD with a confidence score between 0 and 95%. Confidence is never 100%."],
  ["05", "Risk analysis", "Sizes the position from your risk-per-trade budget and a 2× volatility stop, caps it by max position %, blocks low-confidence or high-volatility trades."],
  ["06", "Paper trade", "If the risk check passes you can send the signal to the paper broker in one click."],
];

function Engine() {
  return (
    <PublicPage>
      <PageHero eyebrow="AI Engine" title={<>From prices to <span className="text-gradient">decisions</span></>} subtitle="A deterministic, explainable pipeline. It does not predict the future and does not guarantee profit." />
      <section className="mx-auto max-w-5xl px-4 pb-12">
        <div className="grid gap-4 md:grid-cols-2">
          {STAGES.map(([n, t, d]) => (
            <div key={n} className="glass rounded-xl p-6">
              <p className="num text-sm text-primary">{n}</p>
              <h3 className="mt-2 font-medium">{t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="mx-auto max-w-5xl px-4 pb-20">
        <h2 className="mb-4 text-2xl font-semibold">Strategies</h2>
        <div className="glass divide-y divide-border rounded-xl">
          {STRATEGIES.map((s) => (
            <div key={s.id} className="flex flex-col gap-1 p-5 md:flex-row md:items-center md:justify-between">
              <p className="font-medium">{s.name}</p>
              <p className="text-sm text-muted-foreground md:max-w-md md:text-right">{s.description}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">Signals are informational outputs of rule-based models. They are not investment advice.</p>
      </section>
    </PublicPage>
  );
}
