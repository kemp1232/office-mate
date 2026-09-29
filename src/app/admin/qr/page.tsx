import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { Eyebrow } from "@/components/ui/card";
import { PageTransition } from "@/components/page-transition";
import { requireAdminPage } from "@/features/auth/dal";
import { QrPoster } from "@/features/qr/qr-poster";
import { attendanceQrUrl } from "@/features/qr/qr-url";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Attendance QR code" };

export default async function AdminQrPage() {
  const viewer = await requireAdminPage("/admin/qr");
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader viewer={viewer} current="qr" />
      <main className="flex-1 px-gutter pb-safe print:px-0">
        <PageTransition>
          <div className="mx-auto flex max-w-(--container-admin) flex-col gap-5 py-5 sm:py-8 print:py-0">
            <div className="print:hidden">
              <Eyebrow>Admin</Eyebrow>
              <h1 className="mt-1 text-2xl tracking-tight sm:text-3xl">Office QR code</h1>
              <p className="mt-1 text-ink-muted">
                Print this and place it at the office. It&apos;s a shortcut only — every Clock In and Clock
                Out still checks sign-in and location.
              </p>
            </div>
            <QrPoster url={attendanceQrUrl(env().BETTER_AUTH_URL)} />
          </div>
        </PageTransition>
      </main>
    </div>
  );
}
