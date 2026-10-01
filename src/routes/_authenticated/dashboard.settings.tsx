import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ErrorState, Loading, PageTitle, Panel, useDashboard, useRefreshDashboard } from "@/components/dash/data";
import { resetPortfolio, updateSettings } from "@/lib/trading.functions";

export const Route = createFileRoute("/_authenticated/dashboard/settings")({ component: Settings });

function Settings() {
  const q = useDashboard();
  const save = useServerFn(updateSettings);
  const reset = useServerFn(resetPortfolio);
  const refresh = useRefreshDashboard();
  const [form, setForm] = useState({ display_name: "", risk_per_trade: 2, max_position_pct: 25 });
  const [bal, setBal] = useState(100000);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const p = q.data?.profile;
    if (p) setForm({ display_name: p.display_name ?? "", risk_per_trade: +p.risk_per_trade, max_position_pct: +p.max_position_pct });
  }, [q.data?.profile]);
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await save({ data: form }); toast.success("Settings saved"); refresh(); } catch (err) { toast.error(err instanceof Error ? err.message : "Save failed"); } finally { setBusy(false); }
  };
  const doReset = async () => {
    try { await reset({ data: { startingBalance: bal } }); toast.success("Virtual account reset"); refresh(); } catch (err) { toast.error(err instanceof Error ? err.message : "Reset failed"); }
  };

  return (
    <>
      <PageTitle title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Profile & risk">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label>Display name</Label><Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Risk per trade (% of equity)</Label><Input type="number" step="0.1" min={0.1} max={10} value={form.risk_per_trade} onChange={(e) => setForm({ ...form, risk_per_trade: Number(e.target.value) })} /></div>
            <div className="space-y-2"><Label>Max position size (% of equity)</Label><Input type="number" min={1} max={100} value={form.max_position_pct} onChange={(e) => setForm({ ...form, max_position_pct: Number(e.target.value) })} /></div>
            <Button disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</Button>
          </form>
        </Panel>
        <Panel title="Reset virtual account">
          <p className="mb-4 text-sm text-muted-foreground">Closes all positions, deletes trade history and restores cash to the chosen balance.</p>
          <div className="space-y-2"><Label>Starting balance (USD)</Label><Input type="number" min={1000} value={bal} onChange={(e) => setBal(Number(e.target.value))} /></div>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive" className="mt-4">Reset account</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Reset virtual account?</AlertDialogTitle><AlertDialogDescription>This permanently removes your paper positions and trade history.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doReset}>Reset</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Panel>
      </div>
    </>
  );
}
