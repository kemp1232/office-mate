import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { PageTransition } from "@/components/page-transition";
import { LinkButton } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/card";
import { requireAdminPage } from "@/features/auth/dal";
import { MemberForm } from "@/features/team/member-form";
import { formValues } from "@/features/team/model";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Add team member" };

export default async function NewMemberPage() {
  const viewer = await requireAdminPage("/admin/team/new");

  return (
    // Outermost element, so React animates the whole page in/out on navigation.
    <PageTransition>
      <div className="flex min-h-dvh flex-col">
        <AppHeader viewer={viewer} current="team" />
        <main className="flex-1 px-gutter pb-safe">
          {/* Same page width as the other Admin pages; the form itself stays a readable width. */}
          <div className="mx-auto flex max-w-(--container-admin) flex-col gap-5 py-5 sm:py-8 [&>*]:max-w-2xl">
            <LinkButton
              variant="link"
              size="sm"
              href="/admin/team"
              icon={<ArrowLeft aria-hidden className="size-4" />}
              className="-ml-2 self-start"
            >
              Team
            </LinkButton>
            <div>
              <Eyebrow>Admin</Eyebrow>
              <h1 className="mt-1 text-2xl tracking-tight sm:text-3xl">Add team member</h1>
              <p className="mt-1 text-ink-muted">
                They&apos;ll sign in with Google using this email. Until then they show as &ldquo;Not signed
                in yet&rdquo;.
              </p>
            </div>
            <MemberForm initial={formValues()} signedIn={false} timezone={env().ATTENDANCE_TIMEZONE} />
          </div>
        </main>
      </div>
    </PageTransition>
  );
}
