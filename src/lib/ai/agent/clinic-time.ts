// ============================================================
// clinicOS — helpers de hora de la clínica.
//
// La agenda mezcla dos representaciones del tiempo:
//   * `clinic_hours` guarda `weekday` + `opens_at`/`closes_at` como
//     hora LOCAL de pared de la clínica (sin zona).
//   * `appointments`/`schedule_blocks` guardan instantes `timestamptz`.
//
// Para calcular disponibilidad y agendar hay que convertir entre ambos
// respetando la zona de la clínica. Lo hacemos sin dependencias
// (date-fns v4 no trae tz en el core) usando el truco estándar con
// `Intl.DateTimeFormat`: formatear un instante en la zona destino da
// sus componentes de pared, y desde componentes de pared se recupera
// el instante corrigiendo por el offset de la zona en ese momento.
//
// V1 es de una sola clínica, así que la zona sale de `CLINIC_TIMEZONE`
// (default America/Mexico_City, que hoy no observa horario de verano —
// offset fijo -06:00 — pero el cálculo es robusto a DST igualmente).
// ============================================================

export const DEFAULT_CLINIC_TIMEZONE = 'America/Mexico_City'

/** Zona IANA de la clínica. Override con `CLINIC_TIMEZONE`. */
export function clinicTimezone(): string {
  const raw = process.env.CLINIC_TIMEZONE
  return raw && raw.trim() ? raw.trim() : DEFAULT_CLINIC_TIMEZONE
}

/** Componentes de pared en una zona dada. `weekday`: 0=domingo … 6=sábado. */
export interface WallParts {
  year: number
  month: number // 1-12
  day: number
  hour: number // 0-23
  minute: number
  second: number
  weekday: number // 0-6, domingo=0 (igual que Date.getUTCDay)
}

const PART_FORMAT = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = PART_FORMAT.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    PART_FORMAT.set(tz, f)
  }
  return f
}

/** Descompone un instante en su hora de pared en la zona `tz`. */
export function wallPartsInTz(instant: Date, tz: string): WallParts {
  const parts = formatterFor(tz).formatToParts(instant)
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0')
  const year = get('year')
  const month = get('month')
  const day = get('day')
  // getUTCDay sobre los componentes de pared da el día de la semana local.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return {
    year,
    month,
    day,
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
    weekday,
  }
}

/** Offset de la zona en ms para un instante dado: (hora local − UTC). */
function tzOffsetMs(instant: Date, tz: string): number {
  const p = wallPartsInTz(instant, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - instant.getTime()
}

/**
 * Instante (UTC) para una hora de pared LOCAL en la zona `tz`.
 *
 * `Date.UTC(...)` da el instante si la pared fuera UTC; le restamos el
 * offset de la zona. El offset se evalúa en el instante estimado y se
 * corrige una segunda vez, lo que resuelve los saltos de DST (en el
 * peor caso, horas inexistentes/ambiguas caen al lado consistente).
 */
export function instantFromWallTime(
  tz: string,
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  let offset = tzOffsetMs(new Date(naiveUtc), tz)
  let instant = new Date(naiveUtc - offset)
  // Segunda pasada: recomputa el offset en el instante corregido.
  const offset2 = tzOffsetMs(instant, tz)
  if (offset2 !== offset) {
    offset = offset2
    instant = new Date(naiveUtc - offset)
  }
  return instant
}

/** Construye un instante desde una hora de pared local `HH:MM` en una fecha local. */
export function instantFromLocalDateTime(
  tz: string,
  date: { year: number; month: number; day: number },
  time: { hour: number; minute: number },
): Date {
  return instantFromWallTime(
    tz,
    date.year,
    date.month,
    date.day,
    time.hour,
    time.minute,
  )
}

/** Parsea `"HH:MM"` o `"HH:MM:SS"` (formato `time` de Postgres) a minutos desde medianoche. */
export function parseClockToMinutes(clock: string): number {
  const [h, m] = clock.split(':')
  return Number(h) * 60 + Number(m ?? '0')
}

// ------------------------------------------------------------
// Formato humano (es-MX) para las respuestas del agente.
// ------------------------------------------------------------

const LABEL_FORMAT = new Map<string, Intl.DateTimeFormat>()

function labelFormatterFor(tz: string): Intl.DateTimeFormat {
  let f = LABEL_FORMAT.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('es-MX', {
      timeZone: tz,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    LABEL_FORMAT.set(tz, f)
  }
  return f
}

/** Etiqueta legible de un instante, p. ej. "martes 8 de julio, 11:00 a.m.". */
export function formatSlotLabel(instant: Date, tz: string): string {
  return labelFormatterFor(tz).format(instant)
}

/** Fecha+hora actual de la clínica, legible, para anclar el prompt. */
export function describeNow(now: Date, tz: string): string {
  return `${formatSlotLabel(now, tz)} (zona ${tz})`
}
