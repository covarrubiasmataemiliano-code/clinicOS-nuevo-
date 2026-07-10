"use client";

/**
 * KpiStrip — resumen operativo arriba del calendario: citas de hoy,
 * anticipos pendientes (con monto por cobrar), anticipos pagados, citas
 * de la semana y —en clínicas multi-doctor— citas sin doctor asignado.
 */

import {
  CalendarCheck,
  CalendarDays,
  HandCoins,
  CheckCircle2,
  UserRoundX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import { CLINIC_CURRENCY } from "@/lib/clinic/types";
import type { AgendaKpis } from "./use-agenda";

interface KpiStripProps {
  kpis: AgendaKpis;
  loading?: boolean;
  /** Citas del rango visible sin doctor asignado (solo multi-doctor). */
  unassignedCount?: number;
  /** La clínica tiene doctores asignables → muestra la tarjeta extra. */
  multiDoctor?: boolean;
}

export function KpiStrip({
  kpis,
  loading = false,
  unassignedCount = 0,
  multiDoctor = false,
}: KpiStripProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4",
        multiDoctor && "xl:grid-cols-5",
      )}
    >
      <KpiCard
        icon={<CalendarCheck className="size-4" />}
        label="Citas de hoy"
        value={loading ? "—" : String(kpis.todayCount)}
        hint="Agenda del día en curso"
      />
      <KpiCard
        icon={<HandCoins className="size-4" />}
        label="Pendientes de anticipo"
        value={loading ? "—" : String(kpis.depositPendingCount)}
        detail={
          !loading && kpis.depositPendingTotal > 0
            ? `${formatCurrency(kpis.depositPendingTotal, CLINIC_CURRENCY)} por cobrar`
            : undefined
        }
        detailClassName="text-warning"
        hint="Prioridad comercial para recepción"
      />
      <KpiCard
        icon={<CheckCircle2 className="size-4 text-success" />}
        label="Anticipos pagados"
        value={loading ? "—" : String(kpis.depositPaidCount)}
        detail={
          !loading && kpis.depositPaidTotal > 0
            ? `${formatCurrency(kpis.depositPaidTotal, CLINIC_CURRENCY)} confirmados`
            : undefined
        }
        detailClassName="text-success"
        hint="Confirmados esta semana"
      />
      <KpiCard
        icon={<CalendarDays className="size-4" />}
        label="Citas de la semana"
        value={loading ? "—" : String(kpis.weekCount)}
        hint="Lunes a domingo en curso"
      />
      {multiDoctor && (
        <KpiCard
          icon={
            <UserRoundX
              className={cn("size-4", unassignedCount > 0 && "text-warning")}
            />
          }
          label="Sin asignar"
          value={loading ? "—" : String(unassignedCount)}
          detail={
            !loading && unassignedCount > 0 ? "Requieren responsable" : undefined
          }
          detailClassName="text-warning"
          hint="Citas del rango visible"
        />
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  detail,
  detailClassName,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
  detailClassName?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-soft transition-shadow hover:shadow-lifted">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-xs font-medium">{label}</p>
      </div>
      <p className="nums mt-2 text-2xl font-semibold text-foreground">{value}</p>
      {detail ? (
        <p className={cn("nums mt-0.5 text-xs font-medium", detailClassName)}>
          {detail}
        </p>
      ) : hint ? (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
