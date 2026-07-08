// ============================================================
// clinicOS — API de Google Calendar (REST).
//
// La app usa UN calendario "Clínica" por cuenta (elección de producto).
// Aquí se crea/encuentra ese calendario y se hace insert/patch/delete de
// eventos. La lógica de mapeo cita → evento vive en `calendar-sync.ts`
// (pura y testeable); este módulo solo hace las llamadas HTTP.
// ============================================================

import { CLINIC_CALENDAR_NAME, GOOGLE_CALENDAR_BASE } from './config'
import { googleFetch, GoogleApiError } from './rest'

interface CalendarResource {
  id: string
  summary?: string
}

interface EventResource {
  id: string
  etag?: string
  status?: string
  htmlLink?: string
}

/**
 * Estructura de evento que Calendar acepta en insert/patch. `start`/`end`
 * usan `dateTime` + `timeZone` (hora de pared + zona IANA de la clínica).
 */
export interface GoogleEventInput {
  summary: string
  description?: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  status?: 'confirmed' | 'tentative' | 'cancelled'
  colorId?: string
}

/**
 * Devuelve el id del calendario "Clínica", creándolo si `existingId` es
 * nulo o ya no existe. Idempotente frente a un id borrado en Google.
 */
export async function ensureClinicCalendar(
  accessToken: string,
  existingId: string | null,
): Promise<string> {
  if (existingId) {
    try {
      const cal = await googleFetch<CalendarResource>(
        accessToken,
        `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(existingId)}`,
      )
      if (cal?.id) return cal.id
    } catch (err) {
      // 404 → el calendario fue borrado en Google; lo recreamos. Otros
      // errores (401, red) se propagan.
      if (!(err instanceof GoogleApiError) || err.status !== 404) throw err
    }
  }
  const created = await googleFetch<CalendarResource>(
    accessToken,
    `${GOOGLE_CALENDAR_BASE}/calendars`,
    { method: 'POST', json: { summary: CLINIC_CALENDAR_NAME } },
  )
  return created.id
}

/** Crea un evento y devuelve su id + etag. */
export async function insertEvent(
  accessToken: string,
  calendarId: string,
  event: GoogleEventInput,
): Promise<{ id: string; etag: string | null }> {
  const created = await googleFetch<EventResource>(
    accessToken,
    `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', json: event },
  )
  return { id: created.id, etag: created.etag ?? null }
}

/**
 * Actualiza un evento existente (PATCH parcial). Devuelve `null` si el
 * evento ya no existe en Google (404) — el llamador decide recrear.
 */
export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: GoogleEventInput,
): Promise<{ id: string; etag: string | null } | null> {
  try {
    const updated = await googleFetch<EventResource>(
      accessToken,
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(
        calendarId,
      )}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', json: event },
    )
    return { id: updated.id, etag: updated.etag ?? null }
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 404) return null
    throw err
  }
}

/**
 * Borra un evento. Trata 404/410 (ya no existe / ya borrado) como éxito
 * idempotente.
 */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await googleFetch(
      accessToken,
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(
        calendarId,
      )}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    )
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) {
      return
    }
    throw err
  }
}
