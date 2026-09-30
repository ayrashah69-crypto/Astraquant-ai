import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, Divider, GoogleButton } from "@/components/site/AuthShell";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — AstraQuant AI" }, { name: "description", content: "Sign in to your AstraQuant AI account." }, { property: "og:title", content: "Sign in — AstraQuant AI" }, { property: "og:description", content: "Access your dashboard." }] }),
  component: Login,
});

function Login() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) nav({ to: "/dashboard" }); }, [user, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    nav({ to: "/dashboard" });
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your trading workspace." footer={<>No account? <Link to="/register" className="text-primary">Create one</Link></>}>
      <GoogleButton />
      <Divider />
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="space-y-2">
          <div className="flex justify-between"><Label htmlFor="pw">Password</Label><Link to="/forgot-password" className="text-xs text-primary">Forgot?</Link></div>
          <Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button className="w-full bg-gradient-brand" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Sign in</Button>
      </form>
    </AuthShell>
  );
}
