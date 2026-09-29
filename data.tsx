import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, AlertTriangle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { getDashboard } from "@/lib/trading.functions";
import { Button } from "@/components/ui/button";

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

export function useDashboard() {
  const fn = useServerFn(getDashboard);
  return useQuery({ queryKey: ["dashboard"], queryFn: () => fn(), refetchInterval: 60_000 });
}

export function useRefreshDashboard() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["dashboard"] });
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="grid min-h-[200px] place-items-center text-sm text-muted-foreground"><span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" />{label}</span></div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="glass grid min-h-[200px] place-items-center rounded-xl p-6 text-center">
      <div>
        <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
        <p className="mt-2 text-sm">{error instanceof Error ? error.message : "Something went wrong"}</p>
        {retry && <Button variant="outline" size="sm" className="mt-3" onClick={retry}>Retry</Button>}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center py-10 text-center text-sm text-muted-foreground">
      <Inbox className="h-6 w-6" />
      <p className="mt-2 font-medium text-foreground">{title}</p>
      {children}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`glass rounded-xl p-4 md:p-5 ${className}`}>
      {(title || action) && <div className="mb-4 flex items-center justify-between gap-2"><h2 className="text-sm font-medium">{title}</h2>{action}</div>}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="glass rounded-xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`num mt-1 text-xl md:text-2xl ${tone ?? ""}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}</div>
      {action}
    </div>
  );
}
