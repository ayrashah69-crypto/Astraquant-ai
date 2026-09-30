import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHero, PublicPage } from "@/components/site/SiteChrome";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — AstraQuant AI" },
      { name: "description", content: "Demo, Pro and Enterprise plans for AstraQuant AI." },
      { property: "og:title", content: "Pricing — AstraQuant AI" },
      { property: "og:description", content: "Start with a free 14-day demo license." },
    ],
  }),
  component: Pricing,
});

const PLANS = [
  { name: "Demo", price: "Free", note: "14 days", cta: "Start demo", enabled: true, features: ["$100k virtual account", "AI signals on 8 instruments", "Unlimited backtests", "Paper trading"] },
  { name: "Pro", price: "Coming soon", note: "Checkout not enabled yet", cta: "Payments disabled", enabled: false, features: ["Everything in Demo", "12-month license", "Priority engine access", "Extended history"] },
  { name: "Enterprise", price: "Custom", note: "Contact required", cta: "Payments disabled", enabled: false, features: ["Everything in Pro", "Team seats", "Custom data feeds", "Integration review"] },
];

function Pricing() {
  return (
    <PublicPage>
      <PageHero eyebrow="Pricing" title={<>Simple, <span className="text-gradient">honest</span> plans</>} subtitle="Online payment is intentionally disabled in this release. Every new account receives a Demo license automatically." />
      <section className="mx-auto grid max-w-6xl gap-6 px-4 pb-20 md:grid-cols-3">
        {PLANS.map((p, i) => (
          <div key={p.name} className={`glass flex flex-col rounded-2xl p-6 ${i === 1 ? "border-primary/50 shadow-glow" : ""}`}>
            <p className="text-sm text-muted-foreground">{p.name}</p>
            <p className="mt-2 text-3xl font-semibold">{p.price}</p>
            <p className="text-xs text-muted-foreground">{p.note}</p>
            <ul className="my-6 flex-1 space-y-2 text-sm">
              {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="h-4 w-4 text-primary" />{f}</li>)}
            </ul>
            {p.enabled ? <Button className="bg-gradient-brand" asChild><Link to="/register">{p.cta}</Link></Button> : <Button disabled variant="outline">{p.cta}</Button>}
          </div>
        ))}
      </section>
    </PublicPage>
  );
}
