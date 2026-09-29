import { ViewTransition, type ReactNode } from "react";

/**
 * Fade-through between routes: old page fades out (300 ms), then the new page fades in (300 ms) —
 * 0.6 s in total, set by `--duration-page` in globals.css. Wrap each page's content, not the layout
 * (layouts persist across navigation). Reduced-motion users get an instant swap.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page-fade" exit="page-fade" default="none">
      {children}
    </ViewTransition>
  );
}
