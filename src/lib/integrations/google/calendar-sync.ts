// ============================================================
// clinicOS — mapeo puro cita → evento de Google Calendar.
//
// Sin BD ni red: decide si una cita debe crear/actualizar un evento o
// borrarlo, y construye el cuerpo del evento. Aislado del cron para que
// sea fácil de testear (estados, zona horaria, color por doctor).
//
// Reglas de estado:
//   pendiente             → evento 'tentative' (aparta tentativo)
//   confirmada/completada → evento 'confirmed'
//   cancelada/no_asistio  → se BORRA el evento (no se deja basura)
// ============================================================

import type { GoogleEventInput } from './calendar'
import type { AppointmentStatus, DepositStatus } from '@/lib/clinic/types'

/** Estados cuyo evento se borra en Google (no ocupan hueco visible). */
const DELETE_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'cancelada',
  'no_asistio',
])

/** Paleta de colores de EVENTO de Google Calendar (colorId → hex). */
const GOOGLE_EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb', // Lavender
  '2': '#33b679', // Sage
  '3': '#8e24aa', // Grape
  '4': '#e67c73', // Flamingo
  '5': '#f6bf26', // Banana
  '6': '#f4511e', // Tangerine
  '7': '#039be5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3f51b5', // Blueberry
  '10': '#0b8043', // Basil
  '11': '#d50000', // Tomato
}

/** Mapea la cita a su estado de evento de Google. */
export function statusToGoogleEventStatus(
  status: AppointmentStatus,
): 'confirmed' | 'tentative' {
  return status === 'pendiente' ? 'tentative' : 'confirmed'
}

/** ¿Esta cita implica borrar su evento en Google? */
export function shouldDeleteEvent(status: AppointmentStatus): boolean {
  return DELETE_STATUSES.has(status)
}

/** Distancia RGB al cuadrado entre dos hex '#rrggbb'. */
function colorDistance(a: string, b: string): number {
  const pa = hexToRgb(a)
  const pb = hexToRgb(b)
  if (!pa || !pb) return Number.POSITIVE_INFINITY
  const dr = pa[0] - pb[0]
  const dg = pa[1] - pb[1]
  const db = pa[2] - pb[2]
  return dr * dr + dg * dg + db * db
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/**
 * Google Calendar solo admite ~11 colores de evento predefinidos (no hex
 * arbitrario). Mapea el color del doctor al colorId más cercano. Devuelve
 * undefined si no hay color (usa el default del calendario).
 */
export function nearestGoogleColorId(hex: string | null): string | undefined {
  if (!hex) return undefined
  let best: string | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const [id, palette] of Object.entries(GOOGLE_EVENT_COLORS)) {
    const d = colorDistance(hex, palette)
    if (d < bestDist) {
      bestDist = d
      best = id
    }
  }
  return best
}

export interface SyncAppointment {
  status: AppointmentStatus
  starts_at: string
  ends_at: string
  notes: string | null
  deposit_status: DepositStatus
  deposit_amount: number | null
}

export interface SyncContext {
  /** Nombre a mostrar del paciente (o teléfono, o "Cita"). */
  contactName: string
  /** Nombre del procedimiento, si tiene. */
  procedureName: string | null
  /** Color hex del doctor asignado, si tiene. */
  doctorColor: string | null
  /** Zona IANA de la clínica (clinicTimezone()). */
  timezone: string
}

/** Título legible del evento. */
export function buildEventSummary(ctx: SyncContext): string {
  const base = ctx.contactName || 'Cita'
  return ctx.procedureName ? `${base} · ${ctx.procedureName}` : base
}

/** Descripción con notas + estado de anticipo. */
export function buildEventDescription(appt: SyncAppointment): string {
  const lines: string[] = []
  if (appt.notes?.trim()) lines.push(appt.notes.trim())
  if (appt.deposit_status === 'pendiente') {
    lines.push(
      appt.deposit_amount != null
        ? `Anticipo pendiente: ${appt.deposit_amount}`
        : 'Anticipo pendiente',
    )
  } else if (appt.deposit_status === 'pagado') {
    lines.push('Anticipo pagado')
  }
  lines.push('— Agendado en clinicOS')
  return lines.join('\n')
}

/** Construye el cuerpo del evento de Google para una cita a sincronizar. */
export function buildEventInput(
  appt: SyncAppointment,
  ctx: SyncContext,
): GoogleEventInput {
  return {
    summary: buildEventSummary(ctx),
    description: buildEventDescription(appt),
    start: {
      dateTime: new Date(appt.starts_at).toISOString(),
      timeZone: ctx.timezone,
    },
    end: {
      dateTime: new Date(appt.ends_at).toISOString(),
      timeZone: ctx.timezone,
    },
    status: statusToGoogleEventStatus(appt.status),
    colorId: nearestGoogleColorId(ctx.doctorColor),
  }
}

export type SyncPlan =
  | { op: 'delete' }
  | { op: 'upsert'; event: GoogleEventInput }

/**
 * Decide qué hacer con una cita: borrar su evento (cancelada/no_asistió)
 * o crear/actualizarlo. Pura — el cron ejecuta la decisión contra la API.
 */
export function planAppointmentSync(
  appt: SyncAppointment,
  ctx: SyncContext,
): SyncPlan {
  if (shouldDeleteEvent(appt.status)) return { op: 'delete' }
  return { op: 'upsert', event: buildEventInput(appt, ctx) }
}
