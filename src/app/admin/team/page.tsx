import type { Metadata } from "next";
import { UserPlus } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { PageTransition } from "@/components/page-transition";
import { LinkButton } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/card";
import { StatusPanel } from "@/components/ui/status-panel";
import { requireAdminPage } from "@/features/auth/dal";
import { memberName } from "@/features/team/model";
import { getTeam } from "@/features/team/service";
import { TeamList } from "@/features/team/team-list";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const viewer = await requireAdminPage("/admin/team");
  const [{ saved }, team] = await Promise.all([searchParams, getTeam(viewer.id)]);
  if (!team) throw new Error("Team unavailable");
  const savedMember = saved ? team.members.find((m) => m.id === saved) : undefined;

  return (
    // Outermost element, so React animates the whole page in/out on navigation.
    <PageTransition>
      <div className="flex min-h-dvh flex-col">
        <AppHeader viewer={viewer} current="team" />
        <main className="flex-1 px-gutter pb-safe">
          <div className="mx-auto flex max-w-(--container-admin) flex-col gap-5 py-5 sm:py-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
              <div className="min-w-0">
                <Eyebrow>Admin</Eyebrow>
                <h1 className="mt-1 text-2xl tracking-tight sm:text-3xl">Team</h1>
                <p className="mt-1 text-ink-muted">
                  Set when each person can clock out, and lock or unlock Clock Out for today.
                </p>
              </div>
              <LinkButton
                href="/admin/team/new"
                icon={<UserPlus aria-hidden className="size-5" />}
                className="shrink-0"
              >
                Add member
              </LinkButton>
            </div>

            <div role="status" aria-live="polite">
              {savedMember ? (
                <StatusPanel compact tone="success" title={`Saved ${memberName(savedMember)}`} />
              ) : null}
            </div>

            <TeamList members={team.members} timezone={team.timezone} />
          </div>
        </main>
      </div>
    </PageTransition>
  );
}
