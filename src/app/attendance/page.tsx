import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { PageTransition } from "@/components/page-transition";
import { AttendanceScreen } from "@/features/attendance/attendance-screen";
import { getTodayState } from "@/features/attendance/service";
import { requireViewer } from "@/features/auth/dal";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const { source } = await searchParams;
  const isQr = source === "qr";
  const viewer = await requireViewer(isQr ? "/attendance?source=qr" : "/attendance");
  const state = await getTodayState(viewer.id);
  if (!state) throw new Error("Attendance state unavailable");

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader viewer={viewer} current="attendance" />
      <main className="flex flex-1 flex-col px-gutter pb-safe">
        <PageTransition>
          <AttendanceScreen
            initialState={state}
            source={isQr ? "QR" : "DIRECT"}
            firstName={viewer.name.split(/\s+/)[0] || viewer.name}
            isAdmin={viewer.role === "admin"}
            serverNow={new Date().toISOString()}
          />
        </PageTransition>
      </main>
    </div>
  );
}
