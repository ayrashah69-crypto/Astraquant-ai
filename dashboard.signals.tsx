import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Empty, ErrorState, Loading, PageTitle, Panel, useDashboard } from "@/components/dash/data";
import { SignalCard, SignalGenerator } from "@/components/dash/widgets";

export const Route = createFileRoute("/_authenticated/dashboard/signals")({ component: Signals });

const PIPE = ["Market Data", "Features", "Strategy", "Action", "Confidence", "Risk Check", "Paper Trade"];

function Signals() {
  const q = useDashboard();
  return (
    <>
      <PageTitle title="AI Signals" subtitle="Rule-based analysis. Signals can be wrong and do not guarantee profit." />
      <Panel className="mb-4">
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {PIPE.map((p, i) => <span key={p} className="flex items-center gap-1.5"><span className="rounded border border-border px-2 py-1">{p}</span>{i < PIPE.length - 1 && <ArrowRight className="h-3 w-3" />}</span>)}
        </div>
        <SignalGenerator />
      </Panel>
      <Panel title="Signal log">
        {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} retry={() => q.refetch()} /> :
          q.data!.signals.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{q.data!.signals.map((s) => <SignalCard key={s.id} s={s} />)}</div> : <Empty title="No signals yet">Pick an instrument and strategy above, then press Analyze.</Empty>}
      </Panel>
    </>
  );
}
