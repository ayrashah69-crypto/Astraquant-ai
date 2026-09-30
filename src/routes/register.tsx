import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, Divider, GoogleButton } from "@/components/site/AuthShell";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Create account — AstraQuant AI" }, { name: "description", content: "Create an AstraQuant AI account with a free demo license." }, { property: "og:title", content: "Create account — AstraQuant AI" }, { property: "og:description", content: "Get a $100k virtual account and 14-day demo license." }] }),
  component: Register,
});

function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/dashboard", data: { display_name: name } } });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setSent(true);
  };

  if (sent) return (
    <AuthShell title="Check your email" subtitle={`We sent a confirmation link to ${email}.`} footer={<Link to="/login" className="text-primary">Back to sign in</Link>}>
      <MailCheck className="mx-auto h-10 w-10 text-primary" />
      <p className="mt-4 text-center text-sm text-muted-foreground">After confirming, your demo license and $100,000 virtual account will be ready.</p>
    </AuthShell>
  );

  return (
    <AuthShell title="Create your account" subtitle="Includes a 14-day demo license and $100,000 of virtual capital." footer={<>Already registered? <Link to="/login" className="text-primary">Sign in</Link></>}>
      <GoogleButton />
      <Divider />
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="n">Display name</Label><Input id="n" required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="e">Email</Label><Input id="e" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="p">Password</Label><Input id="p" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <Button className="w-full bg-gradient-brand" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Create account</Button>
        <p className="text-xs text-muted-foreground">By continuing you acknowledge that AstraQuant AI is simulation software and not financial advice.</p>
      </form>
    </AuthShell>
  );
}
