import type { ComponentPropsWithoutRef } from "react";

export function Card({ className = "", ...rest }: ComponentPropsWithoutRef<"section">) {
  return (
    <section className={`rounded-card border border-stroke bg-surface p-5 sm:p-6 ${className}`} {...rest} />
  );
}

export function Eyebrow({ className = "", ...rest }: ComponentPropsWithoutRef<"p">) {
  return <p className={`text-eyebrow font-bold text-accent uppercase ${className}`} {...rest} />;
}
