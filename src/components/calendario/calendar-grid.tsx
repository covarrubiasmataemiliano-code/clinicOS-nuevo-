"use client";

/**
 * CalendarGrid — rejilla horaria del calendario clínico.
 *
 * Motor de layout: una CSS var `--hour-h` (px por hora) + una ventana
 * horaria [startHour, endHour) configurables desde la página (densidad
 * cómoda/compacta y horario operativo/extendido). Toda cita/bloqueo se
 * posiciona con `top = (hInicio - startHour) * hourH`. Un único
 * contenedor de scroll con encabezados de día *sticky* arriba y gutter
 * de horas *sticky* a la izquierda (no se desincronizan al hacer scroll
 * horizontal). Tres vistas: semana (7 columnas de día), día (1) y equipo
 * (una columna por doctor + "Sin asignar", para un solo día).
 *
 * Look 100% tokens del panel (porcelana/petróleo, shadcn): sin CSS
 * global, sin colores hardcodeados salvo `provider_color` (dato).
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import {
  formatTime,
  isSameDay,
  layoutOverlaps,
  minutesIntoDay,
  segmentForDay,
} from "@/lib/clinic/calendar";
import { APPOINTMENT_STATUS, type Tone } from "@/lib/clinic/status-maps";
import type {
  AppointmentStatus,
  AppointmentWithRelations,
  Doctor,
  ScheduleBlock,
} from "@/lib/clinic/types";

export type CalendarView = "semana" | "dia" | "team";

/** Altura visual mínima de un bloque, en px (bloques muy cortos). */
const MIN_BLOCK_PX = 34;
/** El tag de estado solo cabe con esta altura o más. */
const TAG_MIN_PX = 46;
/** Alto de la fila de encabezados (px). Coincide con el corner y el gutter. */
const HEAD_H = 56;

/** Estilo del contenedor de cita por estado (tokens; adapta a modo/acento). */
const BLOCK_STYLES: Record<
  AppointmentStatus,
  { container: string; bar: string; struck: boolean }
> = {
  pendiente: {
    container: "border-warning/30 bg-warning/15 hover:bg-warning/25 text-foreground",
    bar: "bg-warning",
    struck: false,
  },
  confirmada: {
    container: "border-primary/30 bg-primary/10 hover:bg-primary/20 text-foreground",
    bar: "bg-primary",
    struck: false,
  },
  completada: {
    container: "border-success/30 bg-success/10 hover:bg-success/20 text-foreground",
    bar: "bg-success",
    struck: false,
  },
  cancelada: {
    container: "border-border bg-muted/60 hover:bg-muted text-muted-foreground opacity-75",
    bar: "bg-muted-foreground/50",
    struck: true,
  },
  no_asistio: {
    container: "border-border bg-muted/60 hover:bg-muted text-muted-foreground opacity-75",
    bar: "bg-muted-foreground/50",
    struck: true,
  },
};

/** Tono de estado → clases del pill (reusa el sistema de <StatusBadge>). */
const TAG_TONE: Record<Tone, string> = {
  primary: "border-primary/25 bg-primary/10 text-primary",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/15 text-warning-foreground dark:text-warning",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const firstName = (name?: string | null) => name?.trim().split(/\s+/)[0];
const initials = (name?: string | null) =>
  (name?.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || "·").toUpperCase();

interface CalendarGridProps {
  view: CalendarView;
  /** Columnas de día: semana=7, día=1, equipo=[el día ancla]. */
  days: Date[];
  /** Doctores con columna en la vista equipo (ya filtrados por la página). */
  teamDoctors?: Doctor[];
  /** Añadir la columna "Sin asignar" en la vista equipo. */
  includeUnassigned?: boolean;
  appointments: AppointmentWithRelations[];
  blocks: ScheduleBlock[];
  now: Date;
  doctorsById?: Map<string, Doctor>;
  /** Ventana horaria visible y densidad (px por hora). */
  startHour: number;
  endHour: number;
  hourH: number;
  onSelectAppointment: (id: string) => void;
  onSelectDay?: (day: Date) => void;
  /** Quick-add desde el encabezado de un día / columna de doctor. */
  onQuickAdd?: (day: Date, doctorId?: string) => void;
}

interface Column {
  key: string;
  day: Date;
  isToday: boolean;
  appts: AppointmentWithRelations[];
  header: ReactNode;
  /** En equipo la barra de la cita usa el tono de estado (la columna ya
   *  identifica al doctor); en semana/día usa el color del doctor. */
  colorBarByStatus: boolean;
}

export function CalendarGrid({
  view,
  days,
  teamDoctors = [],
  includeUnassigned = false,
  appointments,
  blocks,
  now,
  doctorsById,
  startHour,
  endHour,
  hourH,
  onSelectAppointment,
  onSelectDay,
  onQuickAdd,
}: CalendarGridProps) {
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);
  const bodyHeight = (endHour - startHour) * hourH;

  // ---- Construcción de columnas según la vista ----
  const columns: Column[] = [];

  if (view === "team") {
    const day = days[0];
    const isToday = isSameDay(day, now);
    for (const doc of teamDoctors) {
      columns.push({
        key: `doc-${doc.user_id}`,
        day,
        isToday,
        appts: appointments.filter((a) => a.doctor_id === doc.user_id),
        colorBarByStatus: true,
        header: (
          <TeamHead
            name={doc.full_name || "Doctor"}
            subtitle="Consultorio"
            color={doc.provider_color}
            onAdd={onQuickAdd ? () => onQuickAdd(day, doc.user_id) : undefined}
          />
        ),
      });
    }
    if (includeUnassigned) {
      columns.push({
        key: "unassigned",
        day,
        isToday,
        appts: appointments.filter((a) => !a.doctor_id),
        colorBarByStatus: true,
        header: (
          <TeamHead
            name="Sin asignar"
            subtitle="Recepción"
            color={null}
            onAdd={onQuickAdd ? () => onQuickAdd(day) : undefined}
          />
        ),
      });
    }
  } else {
    for (const day of days) {
      const isToday = isSameDay(day, now);
      columns.push({
        key: day.toISOString(),
        day,
        isToday,
        appts: appointments,
        colorBarByStatus: false,
        header: (
          <DayHead
            day={day}
            isToday={isToday}
            onSelect={onSelectDay ? () => onSelectDay(day) : undefined}
            onAdd={onQuickAdd ? () => onQuickAdd(day) : undefined}
          />
        ),
      });
    }
  }

  // La etiqueta "Ahora" solo en la primera columna de hoy (evita repetirla
  // en las columnas de la vista equipo, todas del mismo día).
  const firstTodayIndex = columns.findIndex((c) => c.isToday);

  const gridTemplateColumns =
    view === "team"
      ? `3.5rem repeat(${columns.length}, minmax(11rem, 1fr))`
      : view === "dia"
      ? `3.5rem minmax(0, 1fr)`
      : `3.5rem repeat(${columns.length}, minmax(7rem, 1fr))`;

  return (
    <div className="relative min-h-0 flex-1 animate-fade-up overflow-auto rounded-2xl border border-border bg-card shadow-soft">
      <div
        className="grid"
        style={
          {
            gridTemplateColumns,
            "--hour-h": `${hourH}px`,
          } as React.CSSProperties
        }
      >
        {/* Fila 1 — esquina + encabezados */}
        <div
          className="sticky left-0 top-0 z-30 flex items-center justify-center border-b border-r border-border bg-card text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          style={{ height: HEAD_H }}
        >
          GMT-6
        </div>
        {columns.map((col) => (
          <div
            key={`head-${col.key}`}
            className="sticky top-0 z-20 border-b border-l border-border bg-card"
            style={{ height: HEAD_H }}
          >
            {col.header}
          </div>
        ))}

        {/* Fila 2 — gutter de horas + columnas */}
        <div className="sticky left-0 z-20 border-r border-border bg-card">
          {hours.map((h) => (
            <div
              key={h}
              className="nums flex items-start justify-end pr-2 pt-1 text-[11px] text-muted-foreground"
              style={{ height: hourH }}
            >
              {`${String(h).padStart(2, "0")}:00`}
            </div>
          ))}
        </div>
        {columns.map((col, i) => (
          <ColumnBody
            key={`body-${col.key}`}
            day={col.day}
            appointments={col.appts}
            blocks={blocks}
            now={now}
            doctorsById={doctorsById}
            startHour={startHour}
            endHour={endHour}
            hourH={hourH}
            bodyHeight={bodyHeight}
            isToday={col.isToday}
            showNowLabel={i === firstTodayIndex}
            colorBarByStatus={col.colorBarByStatus}
            onSelectAppointment={onSelectAppointment}
          />
        ))}
      </div>

      {appointments.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-28 flex justify-center px-6">
          <p className="max-w-sm rounded-2xl border border-dashed border-border bg-card/80 px-6 py-5 text-center text-sm text-muted-foreground shadow-soft">
            No hay citas con estos filtros. Prueba con “Todos” los doctores o
            limpia la búsqueda.
          </p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Encabezados
// ------------------------------------------------------------

function DayHead({
  day,
  isToday,
  onSelect,
  onAdd,
}: {
  day: Date;
  isToday: boolean;
  onSelect?: () => void;
  onAdd?: () => void;
}) {
  const weekdayShort = capitalize(
    day.toLocaleDateString("es-MX", { weekday: "short" }).replace(/\.$/, ""),
  );
  const weekdayLong = capitalize(
    day.toLocaleDateString("es-MX", { weekday: "long" }),
  );
  return (
    <div className="flex h-full items-center justify-between gap-1 px-2.5">
      <button
        type="button"
        onClick={onSelect}
        disabled={!onSelect}
        aria-label={onSelect ? `Ver el día ${weekdayLong} ${day.getDate()}` : undefined}
        className={cn(
          "min-w-0 rounded-lg py-1 pr-1 text-left transition-colors",
          onSelect && "hover:text-primary",
        )}
      >
        <span className="flex items-baseline gap-1">
          <span className="text-[13px] font-semibold text-foreground">
            {weekdayShort}
          </span>
          <span
            className={cn(
              "nums text-[13px] font-semibold",
              isToday
                ? "flex size-6 items-center justify-center rounded-full bg-primary text-[12px] text-primary-foreground"
                : "text-foreground",
            )}
          >
            {day.getDate()}
          </span>
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {weekdayLong}
        </span>
      </button>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Nueva cita este día"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        >
          <Plus className="size-4" />
        </button>
      )}
    </div>
  );
}

function TeamHead({
  name,
  subtitle,
  color,
  onAdd,
}: {
  name: string;
  subtitle: string;
  color: string | null;
  onAdd?: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-between gap-2 px-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ backgroundColor: color || "var(--primary)" }}
        >
          {initials(name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-foreground">
            {name}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {subtitle}
          </span>
        </span>
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Nueva cita para ${name}`}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        >
          <Plus className="size-4" />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Cuerpo de una columna (citas + bloqueos + now-line)
// ------------------------------------------------------------

function ColumnBody({
  day,
  appointments,
  blocks,
  now,
  doctorsById,
  startHour,
  endHour,
  hourH,
  bodyHeight,
  isToday,
  showNowLabel,
  colorBarByStatus,
  onSelectAppointment,
}: {
  day: Date;
  appointments: AppointmentWithRelations[];
  blocks: ScheduleBlock[];
  now: Date;
  doctorsById?: Map<string, Doctor>;
  startHour: number;
  endHour: number;
  hourH: number;
  bodyHeight: number;
  isToday: boolean;
  showNowLabel: boolean;
  colorBarByStatus: boolean;
  onSelectAppointment: (id: string) => void;
}) {
  const winStart = startHour * 60;
  const winEnd = endHour * 60;

  /** Posición vertical en px de un intervalo dentro de la ventana. */
  const place = (start: Date, end: Date) => {
    const from = minutesIntoDay(start);
    const to = minutesIntoDay(end);
    if (to <= winStart || from >= winEnd) return null;
    const clampedFrom = Math.max(from, winStart);
    const clampedTo = Math.min(to, winEnd);
    const top = ((clampedFrom - winStart) / 60) * hourH;
    const height = Math.max(((clampedTo - clampedFrom) / 60) * hourH - 3, MIN_BLOCK_PX);
    return { top, height };
  };

  const dayAppointments = appointments
    .map((appointment) => ({
      appointment,
      segment: segmentForDay(
        new Date(appointment.starts_at),
        new Date(appointment.ends_at),
        day,
      ),
    }))
    .filter(
      (
        x,
      ): x is {
        appointment: AppointmentWithRelations;
        segment: NonNullable<ReturnType<typeof segmentForDay>>;
      } => x.segment !== null,
    );

  const layout = layoutOverlaps(
    dayAppointments.map(({ appointment, segment }) => ({
      id: appointment.id,
      start: segment.start.getTime(),
      end: segment.end.getTime(),
    })),
  );

  const dayBlocks = blocks
    .map((block) => ({
      block,
      segment: segmentForDay(
        new Date(block.starts_at),
        new Date(block.ends_at),
        day,
      ),
    }))
    .filter(
      (
        x,
      ): x is { block: ScheduleBlock; segment: NonNullable<ReturnType<typeof segmentForDay>> } =>
        x.segment !== null,
    );

  const nowMinutes = minutesIntoDay(now);
  const showNow = isToday && nowMinutes >= winStart && nowMinutes <= winEnd;
  const nowTop = ((nowMinutes - winStart) / 60) * hourH;

  return (
    <div
      className={cn(
        "relative overflow-hidden border-l border-border",
        isToday && "bg-primary/[0.03]",
      )}
      style={{
        minHeight: bodyHeight,
        // Líneas de hora al inicio de cada bloque (alinean con el gutter).
        background:
          "repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent var(--hour-h))",
      }}
    >
      {/* Bloqueos (rayado, debajo de las citas, sin robar clicks) */}
      {dayBlocks.map(({ block, segment }) => {
        const pos = place(segment.start, segment.end);
        if (!pos) return null;
        return (
          <div
            key={block.id}
            title={block.reason ?? "Horario bloqueado"}
            className="pointer-events-none absolute inset-x-0.5 z-0 overflow-hidden rounded-md border border-border bg-muted/50 px-1.5 py-1 text-muted-foreground bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,var(--border)_5px,var(--border)_6px)]"
            style={{ top: pos.top, height: pos.height }}
          >
            <p className="truncate text-[11px] font-medium">
              {block.reason || "Horario bloqueado"}
            </p>
            <p className="nums truncate text-[10px] text-muted-foreground/80">
              {formatTime(new Date(block.starts_at))} –{" "}
              {formatTime(new Date(block.ends_at))}
            </p>
          </div>
        );
      })}

      {/* Citas */}
      {dayAppointments.map(({ appointment, segment }) => {
        const pos = place(segment.start, segment.end);
        if (!pos) return null;
        const slot = layout.get(appointment.id) ?? { column: 0, columns: 1 };
        const style = BLOCK_STYLES[appointment.status];
        const width = 100 / slot.columns;

        const doctor = appointment.doctor_id
          ? doctorsById?.get(appointment.doctor_id)
          : undefined;
        const doctorFirstName = firstName(doctor?.full_name);
        const useDoctorColor =
          !colorBarByStatus && !style.struck && !!doctor?.provider_color;

        const durationMin = Math.round(
          (new Date(appointment.ends_at).getTime() -
            new Date(appointment.starts_at).getTime()) /
            60000,
        );
        const statusMeta = APPOINTMENT_STATUS[appointment.status];
        const showTag = pos.height >= TAG_MIN_PX;
        const paid = appointment.deposit_status === "pagado";

        return (
          <button
            key={appointment.id}
            type="button"
            onClick={() => onSelectAppointment(appointment.id)}
            className={cn(
              "absolute z-10 flex items-stretch overflow-hidden rounded-xl border text-left shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lifted motion-reduce:transform-none",
              style.container,
            )}
            style={{
              top: pos.top,
              height: pos.height,
              left: `calc(${slot.column * width}% + 3px)`,
              width: `calc(${width}% - 6px)`,
            }}
          >
            <span
              aria-hidden
              className={cn("w-1.5 shrink-0", !useDoctorColor && style.bar)}
              style={
                useDoctorColor ? { backgroundColor: doctor!.provider_color! } : undefined
              }
            />
            <span
              className={cn(
                "flex min-w-0 flex-1 flex-col justify-center py-1 pl-2",
                showTag ? "pr-14" : "pr-2",
              )}
            >
              <span className="sr-only">{statusMeta.label}</span>
              <span className="nums flex items-center gap-1 text-[10px] font-bold text-foreground/70">
                {formatTime(new Date(appointment.starts_at))} · {durationMin} min
                {paid && (
                  <>
                    <span
                      aria-hidden
                      className="inline-block size-1.5 rounded-full bg-success"
                    />
                    <span className="sr-only">Anticipo pagado</span>
                  </>
                )}
              </span>
              <span
                className={cn(
                  "truncate text-xs font-bold leading-tight",
                  style.struck && "line-through",
                )}
              >
                {appointment.contact?.name ||
                  appointment.contact?.phone ||
                  "Sin contacto"}
              </span>
              <span className="nums truncate text-[10px] leading-tight text-foreground/70">
                {appointment.procedure?.name || "Cita"}
                {doctorFirstName ? ` · ${doctorFirstName}` : ""}
              </span>
            </span>
            {showTag && (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1.5 top-1.5 rounded-full border px-1.5 py-0.5 text-[10px] font-bold",
                  TAG_TONE[statusMeta.tone],
                )}
              >
                {statusMeta.label}
              </span>
            )}
          </button>
        );
      })}

      {/* Línea de "ahora" */}
      {showNow && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-[15]"
          style={{ top: nowTop }}
        >
          <div className="relative h-px bg-destructive">
            <span className="absolute -left-0.5 -top-[3px] size-[7px] rounded-full bg-destructive" />
            {showNowLabel && (
              <span className="nums absolute -top-2.5 left-1.5 rounded-full border border-destructive/30 bg-card px-1.5 text-[10px] font-bold text-destructive">
                Ahora
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
