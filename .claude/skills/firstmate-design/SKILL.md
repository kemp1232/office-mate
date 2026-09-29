---
name: firstmate-design
description: First Mate visual language, design tokens, mobile-first layout, icons, motion and accessibility rules. Use for any UI change.
---

# First Mate design

Reference: https://www.firstmate.tech/ (Next.js + Tailwind v4 site) and the mockups in
`docs/Geofenced Attendance.pdf`. Full notes: `docs/design-system.md`.

## Tokens (only source: `src/app/globals.css` `@theme`)

- Colour: `accent #424bd1` (actions), `ink #282943` (text), `ink-strong #131313` (headings),
  `ink-muted #5f606c`, `canvas #f9f9f9`, `surface #fff`, `stroke`, `line`, `night #14151f` (clocked-in card),
  `clock-out #cf4d17` (mockup orange, AA with large bold label), status `success/warning/danger` + `-tint`.
- Type: Satoshi (self-hosted, `next/font/local`), 500 body / 700 headings; eyebrow = 12px bold uppercase tracked.
- Radius: card 18px, panel 14px, button 12px, input 8px. **No shadows** — fills + hairline borders.
- Sizes: touch ≥ 44px (`--touch-min`), buttons 52px, Clock In/Out CTA 64px full-width.
- Never hard-code hex/px in components when a token exists. Add tokens there first.

## Layout

- Attendance is designed for 320–430px phones first; content column max 440px, centred on desktop.
- Order: compact header → date + greeting → today card (centred in free space) → status panel → CTA
  anchored in the thumb zone → privacy line. The CTA must not move when a status appears.
- Short landscape (`short-landscape:` variant) → two columns.
- Safe areas: `pt-safe`, `pb-safe`, `px-gutter` utilities; use `min-h-dvh`, never `100vh`.
- No hover-only interactions, no dense tables, no horizontal scroll.

## Icons

`lucide-react` only. Icons support labels; icon-only buttons need `aria-label` + `title`.

## Motion

- Page fade-through: `<PageTransition>` (React `<ViewTransition>`), old page 200ms out then new 200ms in
  (0.4 s, `--duration-page`). It must be the page's OUTERMOST element (React only animates enter/exit
  when no newly inserted DOM node sits above it); never in a layout. The browser's root cross-fade is off.
- Component transitions 150–200ms `ease-standard` on colour/background/border/opacity.
- `prefers-reduced-motion` disables animations globally (globals.css). Don't over-animate.

## Accessibility

Buttons get `cursor: pointer` globally (disabled ones don't). Semantic elements, visible labels, `Field` wires hints/errors via `aria-describedby`, status in
`role="status"` live regions, state never by colour alone (icon + text), visible focus ring, AA contrast.
`tests/e2e/layout.spec.ts` enforces overflow, 44px targets and axe (serious/critical) on every device.
