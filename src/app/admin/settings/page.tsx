import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { Eyebrow } from "@/components/ui/card";
import { PageTransition } from "@/components/page-transition";
import { requireAdminPage } from "@/features/auth/dal";
import { getAdminSettings } from "@/features/settings/service";
import { SettingsForm } from "@/features/settings/settings-form";

export const metadata: Metadata = { title: "Admin settings" };

export default async function AdminSettingsPage() {
  const viewer = await requireAdminPage("/admin/settings");
  const settings = await getAdminSettings(viewer.id);
  if (!settings) throw new Error("Admin settings unavailable");

  return (
    // Outermost element, so React animates the whole page in/out on navigation.
    <PageTransition>
      <div className="flex min-h-dvh flex-col">
        <AppHeader viewer={viewer} current="settings" />
        <main className="flex-1 px-gutter lg:pb-10">
          <div className="mx-auto flex max-w-(--container-admin) flex-col gap-5 pt-5 sm:pt-8">
            <div>
              <Eyebrow>Admin</Eyebrow>
              <h1 className="mt-1 text-2xl tracking-tight sm:text-3xl">Attendance settings</h1>
              <p className="mt-1 text-ink-muted">
                One office for the whole team. Changes apply to the next Clock In or Clock Out.
              </p>
            </div>
            <SettingsForm initial={settings} />
          </div>
        </main>
      </div>
    </PageTransition>
  );
}
