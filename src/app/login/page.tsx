import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";
import { googleErrorMessage } from "@/features/auth/auth-errors";
import { AuthShell } from "@/features/auth/auth-shell";
import { getViewer } from "@/features/auth/dal";
import { GoogleSignIn } from "@/features/auth/google-sign-in";
import { authPath, safeNextPath } from "@/features/auth/safe-next";

export const metadata: Metadata = { title: "Sign in" };

type Search = Promise<{ next?: string; error?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (await getViewer()) redirect(next);
  const error = googleErrorMessage(params.error);

  return (
    <AuthShell
      eyebrow="Team sign in"
      title="Clock in at the office"
      lead="Sign in with your First Mate Google Workspace account to record today's attendance."
      footer={
        <LinkButton
          variant="link"
          size="sm"
          href={authPath("/login/admin", next)}
          icon={<ShieldCheck aria-hidden className="size-4" />}
        >
          Admin sign in
        </LinkButton>
      }
    >
      <div className="flex flex-col gap-5">
        <div role="status" aria-live="polite">
          {error ? <StatusPanel compact tone="danger" title={error} /> : null}
        </div>
        <GoogleSignIn next={next} />
      </div>
    </AuthShell>
  );
}
