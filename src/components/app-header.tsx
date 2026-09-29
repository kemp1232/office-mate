import Image from "next/image";
import Link from "next/link";
import { ClipboardCheck, QrCode, Settings } from "lucide-react";
import { iconButtonClass } from "@/components/ui/button";
import type { Viewer } from "@/features/auth/dal";
import { SignOutButton } from "@/features/auth/sign-out-button";

/** Compact First Mate header. Admin links only render for Admins (and are enforced server-side). */
export function AppHeader({
  viewer,
  current,
}: {
  viewer: Viewer;
  current?: "attendance" | "settings" | "qr";
}) {
  return (
    <header
      style={{ viewTransitionName: "app-header" }}
      className="sticky top-0 z-10 border-b border-stroke bg-surface/95 pt-safe px-gutter backdrop-blur print:hidden"
    >
      <div className="mx-auto flex h-(--header-height) max-w-(--container-admin) items-center justify-between gap-3">
        <Link
          href="/attendance"
          aria-label="First Mate Attendance home"
          className="flex min-h-(--touch-min) min-w-(--touch-min) items-center gap-2.5 rounded-button pr-2"
        >
          <Image src="/brand/mark.svg" alt="" width={34} height={34} priority />
          <span className="leading-tight whitespace-nowrap max-[359px]:sr-only">
            <span className="block text-[0.95rem] font-bold text-ink-strong">First Mate</span>
            <span className="block text-xs text-ink-muted">Attendance</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {viewer.role === "admin" ? (
            <>
              <Link
                href="/attendance"
                className={iconButtonClass}
                aria-label="Attendance"
                title="Attendance"
                aria-current={current === "attendance" ? "page" : undefined}
              >
                <ClipboardCheck aria-hidden className="size-5" />
              </Link>
              <Link
                href="/admin/settings"
                className={iconButtonClass}
                aria-label="Admin settings"
                title="Admin settings"
                aria-current={current === "settings" ? "page" : undefined}
              >
                <Settings aria-hidden className="size-5" />
              </Link>
              <Link
                href="/admin/qr"
                className={iconButtonClass}
                aria-label="Attendance QR code"
                title="Attendance QR code"
                aria-current={current === "qr" ? "page" : undefined}
              >
                <QrCode aria-hidden className="size-5" />
              </Link>
            </>
          ) : null}
          <SignOutButton email={viewer.email} />
        </nav>
      </div>
    </header>
  );
}
