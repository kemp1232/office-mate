import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { PageTransition } from "@/components/page-transition";
import { LinkButton } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/card";
import { requireAdminPage } from "@/features/auth/dal";
import { MemberAccess } from "@/features/team/member-access";
import { MemberForm } from "@/features/team/member-form";
import { formValues, memberName } from "@/features/team/model";
import { getTeam } from "@/features/team/service";

export const metadata: Metadata = { title: "Edit team member" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminPage(`/admin/team/${encodeURIComponent(id)}`);
  if (!UUID.test(id)) notFound();
  const team = await getTeam(viewer.id);
  if (!team) throw new Error("Team unavailable");
  const member = team.members.find((m) => m.id === id);
  if (!member) notFound();
  const name = memberName(member);

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
            <div className="min-w-0">
              <Eyebrow>Edit team member</Eyebrow>
              <h1 className="mt-1 text-2xl tracking-tight break-words sm:text-3xl">{name}</h1>
              <p className="mt-1 break-all text-ink-muted">{member.email}</p>
            </div>
            {/* Keyed so the form resets to the saved values after a save or reactivation. */}
            <MemberForm
              key={JSON.stringify(formValues(member))}
              initial={formValues(member)}
              signedIn={member.signedIn}
              timezone={team.timezone}
            />
            <MemberAccess
              memberId={member.id}
              memberName={name}
              deactivated={Boolean(member.deactivatedAt)}
            />
          </div>
        </main>
      </div>
    </PageTransition>
  );
}
