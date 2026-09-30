import { createFileRoute } from "@tanstack/react-router";
import { PageHero, PublicPage } from "@/components/site/SiteChrome";
import { BacktestPanel } from "@/components/BacktestPanel";
import { runPublicBacktest } from "@/lib/trading.functions";

export const Route = createFileRoute("/backtesting")({
  head: () => ({
    meta: [
      { title: "Backtesting — AstraQuant AI" },
      { name: "description", content: "Test trading strategies on historical data with drawdown and win/loss statistics. Results are simulated." },
      { property: "og:title", content: "Backtesting — AstraQuant AI" },
      { property: "og:description", content: "Run a simulated historical backtest in your browser — no account needed." },
    ],
  }),
  component: Backtesting,
});

function Backtesting() {
  return (
    <PublicPage>
      <PageHero eyebrow="Backtesting" title={<>Test ideas on <span className="text-gradient">history</span></>} subtitle="Pick a strategy, a date range and starting virtual capital. Everything below is BACKTESTED and SIMULATED." />
      <section className="mx-auto max-w-7xl px-4 pb-20">
        <BacktestPanel run={(data) => runPublicBacktest({ data })} />
      </section>
    </PublicPage>
  );
}
