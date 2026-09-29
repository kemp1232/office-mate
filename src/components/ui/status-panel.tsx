import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import type { Tone } from "@/features/attendance/messages";

const toneStyles: Record<Tone, { panel: string; icon: string; Icon: typeof Info; label: string }> = {
  neutral: { panel: "bg-surface-muted", icon: "text-ink-muted", Icon: Info, label: "Info" },
  progress: {
    panel: "bg-surface-muted",
    icon: "text-accent animate-spin",
    Icon: Loader2,
    label: "In progress",
  },
  success: { panel: "bg-success-tint", icon: "text-success", Icon: CheckCircle2, label: "Success" },
  warning: { panel: "bg-warning-tint", icon: "text-warning", Icon: AlertTriangle, label: "Warning" },
  danger: { panel: "bg-danger-tint", icon: "text-danger", Icon: XCircle, label: "Error" },
};

/**
 * Tinted status panel from the mockups. State is conveyed by icon + text, never colour alone.
 */
export function StatusPanel({
  tone,
  title,
  detail,
  children,
  compact = false,
}: {
  compact?: boolean;
  tone: Tone;
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  const { panel, icon, Icon, label } = toneStyles[tone];
  return (
    <div
      className={`flex animate-rise-in flex-col items-center rounded-panel px-5 text-center transition-colors duration-(--duration-base) ${compact ? "gap-1 py-4" : "gap-1.5 py-6"} ${panel}`}
    >
      <Icon aria-hidden className={`${compact ? "size-6" : "mb-1 size-7"} ${icon}`} strokeWidth={2} />
      <span className="sr-only">{label}: </span>
      <p className="text-lg leading-snug font-bold text-ink-strong">{title}</p>
      {detail ? <p className="text-sm text-ink-muted">{detail}</p> : null}
      {children}
    </div>
  );
}
