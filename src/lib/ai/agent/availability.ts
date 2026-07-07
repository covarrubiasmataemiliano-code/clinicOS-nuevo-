// ============================================================
// clinicOS — cálculo de disponibilidad (free/busy en vivo).
//
// No hay función SQL de disponibilidad (ver migración 031): se calcula
// en app, igual que en el diseño legacy. Regla:
//
//   slots libres = ventanas de `clinic_hours` del día
//                  − `schedule_blocks` (bloqueos)
//                  − `appointments` activas (pendiente/confirmada/…)
//                  recorridas en la grilla de `slot_minutes`.
//
// Función PURA (sin DB, sin reloj propio) para poder testearla a fondo;
// el reloj (`from`) y los datos entran por parámetro.
// ============================================================

import {
  instantFromLocalDateTime,
  parseClockToMinutes,
  wallPartsInTz,
} from './clinic-time'

export interface ClinicHoursRow {
  weekday: number // 0=domingo … 6=sábado
  opens_at: string // "HH:MM" | "HH:MM:SS" (hora local de la clínica)
  closes_at: string
  slot_minutes: number
}

export interface BusyInterval {
  startsAt: Date
  endsAt: Date
}

export interface AvailabilitySlot {
  /** Inicio del hueco (instante UTC). */
  startsAt: Date
  /** Fin = inicio + duración solicitada. */
  endsAt: Date
}

export interface ComputeSlotsArgs {
  timezone: string
  hours: ClinicHoursRow[]
  /** Bloqueos + citas activas, ya como intervalos ocupados. */
  busy: BusyInterval[]
  /** Duración que necesita el paciente, en minutos. */
  durationMinutes: number
  /** Límite inferior: no se ofrecen huecos antes de este instante. */
  from: Date
  /** Cuántos días hacia adelante explorar (incluye el día de `from`). */
  days: number
  /** Tope de huecos devueltos (ordenados por cercanía). */
  limit?: number
}

function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

/**
 * Calcula los próximos huecos libres. Determinista: mismo input →
 * mismo output. Los huecos salen ordenados del más próximo al más
 * lejano y recortados a `limit`.
 */
export function computeAvailableSlots(args: ComputeSlotsArgs): AvailabilitySlot[] {
  const {
    timezone: tz,
    hours,
    busy,
    durationMinutes,
    from,
    days,
    limit = 12,
  } = args

  if (durationMinutes <= 0 || days <= 0 || hours.length === 0) return []

  // Índice de ventanas por día de la semana.
  const byWeekday = new Map<number, ClinicHoursRow[]>()
  for (const h of hours) {
    const list = byWeekday.get(h.weekday) ?? []
    list.push(h)
    byWeekday.set(h.weekday, list)
  }

  const slots: AvailabilitySlot[] = []
  const fromLocal = wallPartsInTz(from, tz)
  // Ancla a mediodía UTC de la fecha local de `from` para enumerar los
  // días calendario de forma robusta a offsets/DST.
  const baseNoon = Date.UTC(
    fromLocal.year,
    fromLocal.month - 1,
    fromLocal.day,
    12,
  )
  const DAY_MS = 24 * 60 * 60 * 1000

  for (let d = 0; d < days; d++) {
    const anchor = new Date(baseNoon + d * DAY_MS)
    const y = anchor.getUTCFullYear()
    const mo = anchor.getUTCMonth() + 1
    const day = anchor.getUTCDate()
    const weekday = new Date(Date.UTC(y, mo - 1, day)).getUTCDay()

    const windows = byWeekday.get(weekday)
    if (!windows) continue

    for (const w of windows) {
      const openMin = parseClockToMinutes(w.opens_at)
      const closeMin = parseClockToMinutes(w.closes_at)
      const step = w.slot_minutes

      // El inicio del último hueco que aún cabe completo en la ventana.
      const lastStartMin = closeMin - durationMinutes
      for (let m = openMin; m <= lastStartMin; m += step) {
        const start = instantFromLocalDateTime(
          tz,
          { year: y, month: mo, day },
          { hour: Math.floor(m / 60), minute: m % 60 },
        )
        if (start.getTime() < from.getTime()) continue
        const end = new Date(start.getTime() + durationMinutes * 60 * 1000)

        const clash = busy.some((b) =>
          overlaps(start, end, b.startsAt, b.endsAt),
        )
        if (clash) continue

        slots.push({ startsAt: start, endsAt: end })
      }
    }
  }

  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  return slots.slice(0, limit)
}
