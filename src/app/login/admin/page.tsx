import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LinkButton } from "@/components/ui/button";
import { AdminLoginForm } from "@/features/auth/admin-login-form";
import { AuthShell } from "@/features/auth/auth-shell";
import { getViewer } from "@/features/auth/dal";
import { authPath, safeNextPath } from "@/features/auth/safe-next";

export const metadata: Metadata = { title: "Admin sign in" };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await getViewer()) redirect(next);
  return (
    <AuthShell
      eyebrow="Admin"
      title="Admin sign in"
      lead="For the Admin account only. Team Members use Google."
      footer={
        <LinkButton variant="link" size="sm" href={authPath("/login", next)}>
          Back to Team sign in
        </LinkButton>
      }
    >
      <AdminLoginForm next={next} />
    </AuthShell>
  );
}
