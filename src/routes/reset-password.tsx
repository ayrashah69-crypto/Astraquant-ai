import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/site/AuthShell";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set new password — AstraQuant AI" }, { name: "description", content: "Choose a new password." }, { property: "og:title", content: "Set new password — AstraQuant AI" }, { property: "og:description", content: "Choose a new password." }] }),
  component: Reset,
});

function Reset() {
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated");
    nav({ to: "/dashboard" });
  };
  return (
    <AuthShell title="Set a new password" subtitle="Open this page from the link in your reset email.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="p">New password</Label><Input id="p" type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <Button className="w-full bg-gradient-brand" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Update password</Button>
      </form>
    </AuthShell>
  );
}
