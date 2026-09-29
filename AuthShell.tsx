import type { ReactNode } from "react";
import { Logo } from "./SiteChrome";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <div className="glass rounded-2xl p-6 md:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </div>
  );
}

export function GoogleButton() {
  return (
    <Button
      type="button" variant="outline" className="w-full"
      onClick={async () => {
        const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/login" });
        if (r.error) toast.error(r.error.message ?? "Google sign-in failed");
      }}
    >
      Continue with Google
    </Button>
  );
}

export function Divider() {
  return <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>;
}
