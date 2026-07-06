import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { StatusMeta, Tone } from "@/lib/status-maps";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/14 text-warning-foreground border-warning/30 dark:text-warning",
  destructive: "bg-destructive/10 text-destructive border-destructive/25",
  primary: "bg-primary/10 text-primary border-primary/25",
  muted: "bg-muted text-muted-foreground border-border",
};

const DOT_CLASSES: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  primary: "bg-primary",
  muted: "bg-muted-foreground",
};

interface StatusBadgeProps {
  tone: Tone;
  children: ReactNode;
  /** Punto de color a la izquierda (con `pulse` para estados "vivos"). */
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}

/** Badge de estado de negocio — uso obligatorio para estados (CONVENTIONS). */
export function StatusBadge({
  tone,
  children,
  dot = false,
  pulse = false,
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            DOT_CLASSES[tone],
            pulse && "animate-pulse-dot"
          )}
        />
      )}
      {children}
    </span>
  );
}

/** Atajo: badge directo desde un StatusMeta de lib/status-maps. */
export function MetaBadge({
  meta,
  dot,
  pulse,
  className,
}: {
  meta: StatusMeta;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <StatusBadge tone={meta.tone} dot={dot} pulse={pulse} className={className}>
      {meta.label}
    </StatusBadge>
  );
}
