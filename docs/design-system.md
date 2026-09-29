# Design system

The Attendance app borrows First Mate's brand language (inspected on www.firstmate.tech, 2026-09-28 —
a Next.js + Tailwind v4 site) and the state designs from the approved proposal PDF, translated into a
focused phone product rather than a marketing layout.

All tokens live in [`src/app/globals.css`](../src/app/globals.css) (`@theme`). Components use the
generated utilities (`bg-accent`, `rounded-card`, `text-ink-muted`, …) — no hard-coded values.

## What we took from firstmate.tech

| Site                                                           | App token                            |
| -------------------------------------------------------------- | ------------------------------------ |
| `--color-accent #424bd1` (buttons, links, eyebrows)            | `accent` (6.65:1 on white)           |
| body `--color-ink #282943`, headings `#131313`                 | `ink`, `ink-strong`                  |
| muted text `#5f606c`                                           | `ink-muted` (6.2:1)                  |
| section fill `#f9f9f9`, hairlines `#f0f0f0` / inputs `#e4e4e4` | `canvas`, `stroke`, `line`           |
| Satoshi 500/700, eyebrow 12–14px bold uppercase tracked        | `font-sans`, `text-eyebrow`          |
| cards 18px radius, buttons 12px, inputs 8px, **no shadows**    | `rounded-card/button/input`          |
| 52px buttons, 150–200ms `cubic-bezier(.4,0,.2,1)`              | `--button-height`, `ease-standard`   |
| logo gradient `#2255DA → #00D9F2` (mark only)                  | kept inside the logo SVG / PWA icons |

From the mockups: the dark "clocked in" hero card (`night #14151f`) with a large time, the orange
Clock Out button (deepened to `clock-out #cf4d17` so the large bold white label passes WCAG AA), peach
warning panel (`warning-tint`), and the dashed geofence circle with an orange pin on the Admin map.

Additions for product states: `success`, `warning`, `danger` + tints, `disabled`. Every status also has
an icon and a text label — never colour alone.

## Spacing & layout

- Tailwind's 4px spacing scale only. Page gutter `--gutter` 16px (24px ≥ 640px) via `px-gutter`, which
  also respects left/right safe areas.
- Rhythm: 20px (`gap-5`) between blocks, 12px (`gap-3`) inside action groups, card padding 20/24px.
- Attendance column max 440px (`max-w-(--container-attendance)`), Admin 1088px.
- Heights: touch minimum 44px, buttons 52px, primary CTA 64px.
- Safe areas: `pt-safe` on headers, `pb-safe` on bottom-anchored content, `min-h-dvh` (never `100vh`).

## Breakpoints (used intentionally)

- **Phone (default)** — single column; the Attendance CTA is anchored in the thumb zone.
- **Short landscape** (`short-landscape:` = landscape & height ≤ 500px) — Attendance splits into two columns.
- **`sm` 640px** — larger gutters/type on tablets.
- **`lg` 1024px** — Admin settings go two-column (map | fields) and the save bar becomes inline.

## Components

`Button` (primary / clock-out / secondary / ghost; md / cta), `LinkButton`, `Card`, `Eyebrow`, `Field`
(label, hint, error, suffix, aria wiring), `StatusPanel` (tone → icon + tint + sr label), `AppHeader`,
`PageTransition`.

## Icons

lucide-react only: ClockArrowUp (Clock In), ClockArrowDown (Clock Out), MapPin, RotateCw (retry),
Settings, QrCode, Printer, Save, ExternalLink (Open report), LogOut, LogIn, UserPlus, LocateFixed, …
Icon-only controls carry `aria-label` and `title`.

## Motion

- Route change: fade-through — old page 200ms out, then new page 200ms in (React `<ViewTransition>`,
  class `page-fade`). The header is anchored (`view-transition-name: app-header`).
- Components: colour/background/border/opacity transitions 150–200ms; status panels rise in 200ms;
  pressed buttons scale to 98.5%.
- `prefers-reduced-motion: reduce` collapses all animation/transition durations.

## Accessibility checklist

Visible labels, `autocomplete`/`inputMode` on fields, errors linked via `aria-describedby` and
`aria-invalid`, status messages in a polite live region, one `h1` per page, focus ring 2px accent with
offset, AA contrast, 44px targets, zoom allowed. Enforced by `tests/e2e/layout.spec.ts` (axe + target sizes).
