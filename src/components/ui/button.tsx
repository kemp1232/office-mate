import type { ComponentPropsWithRef, ReactNode } from "react";
import Link from "next/link";

type Variant = "primary" | "clock-out" | "danger" | "secondary" | "link";
type Size = "sm" | "md" | "cta";

const base =
  "inline-flex select-none items-center justify-center gap-2.5 rounded-button font-bold " +
  "transition-[background-color,color,border-color,opacity,transform] duration-(--duration-base) ease-(--ease-standard) " +
  "active:scale-[0.985] disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-ink disabled:border-transparent " +
  "aria-disabled:pointer-events-none aria-disabled:bg-disabled aria-disabled:text-disabled-ink";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-ink-inverse hover:bg-accent-strong",
  "clock-out": "bg-clock-out text-ink-inverse hover:bg-clock-out-strong",
  danger: "bg-danger text-ink-inverse hover:bg-danger/90",
  secondary: "border border-line bg-surface text-ink-strong hover:border-accent/40 hover:bg-accent-tint",
  link: "px-2! text-accent hover:underline",
};

const sizes: Record<Size, string> = {
  sm: "min-h-(--touch-min) px-4 text-sm",
  md: "min-h-(--button-height) px-6 text-base",
  cta: "min-h-(--cta-height) w-full px-6 text-xl",
};

function buttonClasses(variant: Variant = "primary", size: Size = "md", className = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`;
}

/** Square 44px icon-only control (header nav, sign out). Pair with aria-label + title. */
export const iconButtonClass =
  "inline-flex size-(--touch-min) items-center justify-center rounded-button text-ink-muted transition-colors duration-(--duration-base) hover:bg-accent-tint hover:text-accent disabled:opacity-50 aria-[current=page]:bg-accent-tint aria-[current=page]:text-accent";

type ButtonProps = ComponentPropsWithRef<"button"> & { variant?: Variant; size?: Size; icon?: ReactNode };

export function Button({ variant, size, icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClasses(variant, size, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

type LinkButtonProps = ComponentPropsWithRef<typeof Link> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
};

export function LinkButton({ variant, size, icon, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
