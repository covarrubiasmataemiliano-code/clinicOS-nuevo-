"use client";

/**
 * Calendario — módulo de clinicOS.
 *
 * Ensambla el hook useAgenda (datos + realtime) con la rejilla horaria,
 * el strip de KPIs y los diálogos de nueva cita / bloqueo / detalle.
 * Vistas: semana (lun→dom), día y equipo médico (columnas por doctor).
 * Controles: densidad (cómoda/compacta), ventana horaria (operativo/
 * extendido), filtro por doctor (chips), estado y búsqueda. El look
 * sigue el tema porcelana/petróleo del panel (tokens shadcn, sin CSS
 * global propio).
 */

import { useMemo, useState } from "react";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAgenda } from "@/components/calendario/use-agenda";
import { KpiStrip } from "@/components/calendario/kpi-strip";
import { CalendarGrid, type CalendarView } from "@/components/calendario/calendar-grid";
import { NewAppointmentDialog } from "@/components/calendario/new-appointment-dialog";
import { BlockScheduleDialog } from "@/components/calendario/block-schedule-dialog";
import { AppointmentSheet } from "@/components/calendario/appointment-sheet";
import {
  addDays,
  formatDayLong,
  formatWeekRange,
  mondayOf,
  startOfDay,
  weekDays,
} from "@/lib/clinic/calendar";

type StatusFilter = "all" | "confirmada" | "deposit_pending" | "completada";
type Density = "comoda" | "compacta";

const STATUS_FILTERS = [
  { id: "all", label: "Todos", dot: "bg-primary" },
  { id: "confirmada", label: "Confirmadas", dot: "bg-success" },
  { id: "deposit_pending", label: "Anticipo pendiente", dot: "bg-warning" },
  { id: "completada", label: "Completadas", dot: "bg-muted-foreground" },
] as const;

export default function CalendarioPage() {
  const [view, setView] = useState<CalendarView>("semana");
  // Ancla de navegación: para "semana" se normaliza al lunes; para "día"
  // y "equipo" es el día mismo (medianoche local).
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [density, setDensity] = useState<Density>("comoda");
  // Horario operativo (08–20) vs extendido (07–22) — recorta el scroll.
  const [workHours, setWorkHours] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Precarga del alta rápida ("+") desde un encabezado de día / doctor.
  const [quickAdd, setQuickAdd] = useState<{ date: Date; doctorId?: string } | null>(
    null,
  );
  // Filtro por doctor: "all" = todos, "unassigned" = sin doctor, o un user_id.
  const [doctorFilter, setDoctorFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Días visibles + rango [inicio, fin) que pide el hook.
  const { days, rangeStart, rangeEnd } = useMemo(() => {
    if (view === "dia" || view === "team") {
      const d = startOfDay(anchor);
      return { days: [d], rangeStart: d, rangeEnd: addDays(d, 1) };
    }
    const monday = mondayOf(anchor);
    return {
      days: weekDays(monday),
      rangeStart: monday,
      rangeEnd: addDays(monday, 7),
    };
  }, [view, anchor]);

  const { appointments, blocks, procedures, doctors, kpis, loading, refetch } =
    useAgenda(rangeStart, rangeEnd);

  // Índice de doctores por user_id, para colorear/etiquetar la rejilla.
  const doctorsById = useMemo(
    () => new Map(doctors.map((d) => [d.user_id, d])),
    [doctors],
  );

  // Citas visibles según el filtro de doctor, estado y búsqueda.
  const visibleAppointments = useMemo(() => {
    let list = appointments;

    if (doctorFilter !== "all") {
      list = list.filter((a) =>
        doctorFilter === "unassigned" ? !a.doctor_id : a.doctor_id === doctorFilter,
      );
    }

    if (statusFilter === "confirmada") {
      list = list.filter((a) => a.status === "confirmada");
    } else if (statusFilter === "deposit_pending") {
      list = list.filter((a) => a.deposit_status === "pendiente");
    } else if (statusFilter === "completada") {
      list = list.filter((a) => a.status === "completada");
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((a) => {
        const cName = (a.contact?.name || "").toLowerCase();
        const cPhone = (a.contact?.phone || "").toLowerCase();
        const pName = (a.procedure?.name || "").toLowerCase();
        return cName.includes(q) || cPhone.includes(q) || pName.includes(q);
      });
    }

    return list;
  }, [appointments, doctorFilter, statusFilter, searchQuery]);

  const unassignedCount = useMemo(
    () => appointments.filter((a) => !a.doctor_id).length,
    [appointments],
  );

  // Columnas de la vista equipo, derivadas del filtro de doctor.
  const { teamDoctors, includeUnassigned } = useMemo(() => {
    if (doctorFilter === "all") return { teamDoctors: doctors, includeUnassigned: true };
    if (doctorFilter === "unassigned")
      return { teamDoctors: [], includeUnassigned: true };
    return {
      teamDoctors: doctors.filter((d) => d.user_id === doctorFilter),
      includeUnassigned: false,
    };
  }, [doctors, doctorFilter]);

  const selected = appointments.find((a) => a.id === selectedId) ?? null;
  const now = new Date();

  const [startHour, endHour] = workHours ? [8, 20] : [7, 22];
  const hourH = density === "compacta" ? 44 : 56;

  const step = view === "semana" ? 7 : 1;
  const goPrev = () => setAnchor((a) => addDays(a, -step));
  const goNext = () => setAnchor((a) => addDays(a, step));
  const goToday = () => setAnchor(startOfDay(new Date()));

  const rangeLabel =
    view === "semana" ? formatWeekRange(anchor) : formatDayLong(days[0]);

  const viewOptions: { id: CalendarView; label: string }[] = [
    { id: "semana", label: "Semana" },
    ...(doctors.length > 0 ? [{ id: "team" as CalendarView, label: "Equipo" }] : []),
    { id: "dia", label: "Día" },
  ];

  const handleQuickAdd = (day: Date, doctorId?: string) => {
    setQuickAdd({ date: day, doctorId });
    setNewOpen(true);
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Calendario</h1>
          <p className="nums text-sm capitalize text-muted-foreground">{rangeLabel}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative hidden sm:block">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar cita…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-64 bg-card pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBlockOpen(true)}
            className="gap-1.5"
          >
            <Lock className="size-4" />
            <span className="hidden sm:inline">Bloquear horario</span>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setQuickAdd(null);
              setNewOpen(true);
            }}
            className="gap-1.5"
          >
            <CalendarPlus className="size-4" />
            Nueva cita
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <KpiStrip
        kpis={kpis}
        loading={loading}
        unassignedCount={unassignedCount}
        multiDoctor={doctors.length > 0}
      />

      {/* Controles */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-2 shadow-soft">
        {/* Navegación + vista */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={goPrev}
              aria-label="Anterior"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={goToday}>
              Hoy
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={goNext}
              aria-label="Siguiente"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <Segmented
            options={viewOptions}
            value={view}
            onChange={(v) => setView(v)}
          />
        </div>

        {/* Chips de doctor */}
        {doctors.length > 0 && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 scrollbar-none">
            <DoctorChip
              label="Todos"
              dotClass="bg-primary"
              active={doctorFilter === "all"}
              onClick={() => setDoctorFilter("all")}
            />
            {doctors.map((d) => (
              <DoctorChip
                key={d.user_id}
                label={d.full_name?.split(" ")[0] || "Doctor"}
                dotColor={d.provider_color}
                active={doctorFilter === d.user_id}
                onClick={() => setDoctorFilter(d.user_id)}
              />
            ))}
            <DoctorChip
              label="Sin asignar"
              dotClass="bg-warning"
              active={doctorFilter === "unassigned"}
              onClick={() => setDoctorFilter("unassigned")}
            />
          </div>
        )}

        {/* Densidad + horario */}
        <div className="flex items-center gap-2">
          <Segmented
            options={[
              { id: "comoda", label: "Cómoda" },
              { id: "compacta", label: "Compacta" },
            ]}
            value={density}
            onChange={(v) => setDensity(v as Density)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWorkHours((w) => !w)}
            aria-pressed={workHours}
            className={cn(
              "h-8 gap-1.5",
              workHours && "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15",
            )}
          >
            <Clock className="size-3.5" />
            <span className="hidden md:inline">Horario operativo</span>
            <span className="md:hidden">Operativo</span>
          </Button>
        </div>
      </div>

      {/* Filtro de estado */}
      <div className="-mt-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.id}
            onClick={() => setStatusFilter(filter.id as StatusFilter)}
            aria-pressed={statusFilter === filter.id}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              statusFilter === filter.id
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className={cn("size-2 rounded-full", filter.dot)} />
            {filter.label}
          </button>
        ))}
      </div>

      {/* Rejilla */}
      <CalendarGrid
        view={view}
        days={days}
        teamDoctors={teamDoctors}
        includeUnassigned={includeUnassigned}
        appointments={visibleAppointments}
        blocks={blocks}
        now={now}
        doctorsById={doctorsById}
        startHour={startHour}
        endHour={endHour}
        hourH={hourH}
        onSelectAppointment={setSelectedId}
        onSelectDay={(day) => {
          setView("dia");
          setAnchor(startOfDay(day));
        }}
        onQuickAdd={handleQuickAdd}
      />

      {/* Diálogos */}
      <NewAppointmentDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        procedures={procedures}
        doctors={doctors}
        defaultDate={quickAdd?.date ?? days[0]}
        defaultDoctorId={quickAdd?.doctorId}
        onCreated={refetch}
      />
      <BlockScheduleDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        defaultDate={days[0]}
        onCreated={refetch}
      />
      <AppointmentSheet
        appointment={selected}
        open={selectedId !== null}
        doctors={doctors}
        onOpenChange={(o) => {
          if (!o) setSelectedId(null);
        }}
        onChanged={refetch}
      />
    </div>
  );
}

// ------------------------------------------------------------
// Controles reutilizables
// ------------------------------------------------------------

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-8 items-center gap-0.5 rounded-lg bg-muted p-[3px]">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          aria-pressed={value === opt.id}
          className={cn(
            "h-full rounded-md px-3 text-xs font-medium transition-all",
            value === opt.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function DoctorChip({
  label,
  dotClass,
  dotColor,
  active,
  onClick,
}: {
  label: string;
  dotClass?: string;
  dotColor?: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span
        className={cn("size-2 rounded-full", dotClass)}
        style={dotColor ? { backgroundColor: dotColor } : undefined}
      />
      {label}
    </button>
  );
}
