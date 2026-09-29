import type { ComponentPropsWithRef, ReactNode } from "react";

type FieldProps = ComponentPropsWithRef<"input"> & {
  label: string;
  hint?: ReactNode;
  error?: string;
  suffix?: string;
};

/** Labelled input with visible label, hint and field-level error wired for screen readers. */
export function Field({ label, hint, error, suffix, id, name, className = "", ...rest }: FieldProps) {
  const inputId = id ?? name;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className="text-sm font-bold text-ink-strong">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          className={`min-h-(--button-height) w-full scroll-mb-32 rounded-input border border-line-strong bg-surface px-4 text-base text-ink-strong transition-colors duration-(--duration-base) placeholder:text-ink-muted focus:border-accent aria-invalid:border-danger ${suffix ? "pr-12" : ""}`}
          {...rest}
        />
        {suffix ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-ink-muted"
          >
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-bold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
