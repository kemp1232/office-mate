import { ViewTransition, type ReactNode } from "react";

/**
 * Fade-through between routes: old page fades out (~200 ms), then the new page fades in
 * (~200 ms). Wrap each page's content (not the layout — layouts persist across navigation).
 * CSS lives in globals.css; reduced-motion users get an instant swap.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page-fade" exit="page-fade" default="none">
      {children}
    </ViewTransition>
  );
}
