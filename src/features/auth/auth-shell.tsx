import Image from "next/image";
import type { ReactNode } from "react";
import { PageTransition } from "@/components/page-transition";
import { Eyebrow } from "@/components/ui/card";

/** Shared phone-first frame for sign-in / sign-up / password pages. */
export function AuthShell({
  eyebrow,
  title,
  lead,
  children,
  footer,
}: {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    // Outermost element, so React animates the whole page in/out on navigation.
    <PageTransition>
      <main className="flex min-h-dvh flex-col pt-safe px-gutter pb-safe">
        <div className="mx-auto flex w-full max-w-(--container-attendance) flex-1 flex-col justify-center gap-6 py-8">
          <div className="flex items-center gap-3">
            <Image src="/brand/mark.svg" alt="" width={44} height={44} priority />
            <div className="leading-tight">
              <p className="text-base font-bold text-ink-strong">First Mate</p>
              <p className="text-sm text-ink-muted">Attendance</p>
            </div>
          </div>
          <section className="rounded-card border border-stroke bg-surface p-5 sm:p-7">
            {eyebrow ? <Eyebrow className="mb-2">{eyebrow}</Eyebrow> : null}
            <h1 className="text-title tracking-tight">{title}</h1>
            {lead ? <p className="mt-2 text-ink-muted">{lead}</p> : null}
            <div className="mt-6">{children}</div>
          </section>
          {footer ? <div className="text-center text-sm text-ink-muted">{footer}</div> : null}
        </div>
      </main>
    </PageTransition>
  );
}
