import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/site/AuthShell";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password — AstraQuant AI" }, { name: "description", content: "Request a password reset link." }, { property: "og:title", content: "Reset password — AstraQuant AI" }, { property: "og:description", content: "Recover access to your account." }] }),
  component: Forgot,
});

function Forgot() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setSent(true);
  };
  return (
    <AuthShell title="Forgot password" subtitle="We'll email you a secure reset link." footer={<Link to="/login" className="text-primary">Back to sign in</Link>}>
      {sent ? <p className="text-sm text-muted-foreground">If an account exists for {email}, a reset link is on its way.</p> : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="e">Email</Label><Input id="e" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <Button className="w-full bg-gradient-brand" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
