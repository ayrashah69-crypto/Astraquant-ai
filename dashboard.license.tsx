import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Loading, PageTitle, Panel, useDashboard, useRefreshDashboard } from "@/components/dash/data";
import { renewDemoLicense, verifyLicense } from "@/lib/trading.functions";
import { dt } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard/license")({ component: License });

function License() {
  const q = useDashboard();
  const verify = useServerFn(verifyLicense);
  const renew = useServerFn(renewDemoLicense);
  const refresh = useRefreshDashboard();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof verify>> | null>(null);
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { license, licenses } = q.data;

  const doVerify = async (k: string) => {
    setBusy(true);
    try { setResult(await verify({ data: { licenseKey: k } })); } catch (e) { toast.error(e instanceof Error ? e.message : "Verification failed"); } finally { setBusy(false); }
  };
  const doRenew = async () => {
    setBusy(true);
    try { await renew(); toast.success("New demo license issued"); refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not issue license"); } finally { setBusy(false); }
  };

  return (
    <>
      <PageTitle title="License" subtitle="Keys are generated and verified on the server." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Active license">
          {license ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <code className="num flex-1 text-sm">{license.license_key}</code>
                <button onClick={() => { navigator.clipboard.writeText(license.license_key); toast.success("Copied"); }} aria-label="Copy key"><Copy className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><p className="text-muted-foreground">Plan</p><p className="font-medium uppercase">{license.plan}</p></div>
                <div><p className="text-muted-foreground">Status</p><p className="font-medium text-success">{license.status}</p></div>
                <div><p className="text-muted-foreground">Expires</p><p className="font-medium">{dt(license.expires_at)}</p></div>
              </div>
              <Button variant="outline" size="sm" onClick={() => doVerify(license.license_key)} disabled={busy}>Verify with server</Button>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">No active license. Signals, backtests and paper trading are locked until one is active.</p>
              <Button onClick={doRenew} disabled={busy} className="bg-gradient-brand">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Issue new 14-day demo license</Button>
              <p className="text-xs text-muted-foreground">Pro and Enterprise licenses will be issued once payments are enabled.</p>
            </div>
          )}
        </Panel>
        <Panel title="Verify a key">
          <form onSubmit={(e) => { e.preventDefault(); doVerify(key.trim().toUpperCase()); }} className="flex gap-2">
            <Input placeholder="AQ-PRO-XXXX-XXXX-XXXX" value={key} onChange={(e) => setKey(e.target.value)} />
            <Button disabled={busy || !key}>Verify</Button>
          </form>
          {result && (
            <div className={`mt-3 rounded-md border p-3 text-sm ${result.valid ? "border-success/40 text-success" : "border-destructive/40 text-destructive"}`}>
              {result.valid ? `Valid ${String(result.plan).toUpperCase()} license · expires ${dt(result.expires_at!)}` : `Invalid: ${result.reason}`}
            </div>
          )}
        </Panel>
      </div>
      <Panel title="License history" className="mt-4">
        <div className="divide-y divide-border text-sm">
          {licenses.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <code className="num text-xs">{l.license_key}</code>
              <span className="text-xs uppercase text-muted-foreground">{l.plan} · {l.status} · created {dt(l.created_at)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
