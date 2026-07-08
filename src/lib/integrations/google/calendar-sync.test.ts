import { describe, it, expect } from 'vitest'

import {
  buildEventInput,
  nearestGoogleColorId,
  planAppointmentSync,
  shouldDeleteEvent,
  statusToGoogleEventStatus,
  type SyncAppointment,
  type SyncContext,
} from './calendar-sync'

function appt(overrides: Partial<SyncAppointment> = {}): SyncAppointment {
  return {
    status: 'confirmada',
    starts_at: '2026-07-10T16:00:00.000Z',
    ends_at: '2026-07-10T17:00:00.000Z',
    notes: null,
    deposit_status: 'no_aplica',
    deposit_amount: null,
    ...overrides,
  }
}

const ctx: SyncContext = {
  contactName: 'Laura Medina',
  procedureName: 'Valoración',
  doctorColor: null,
  timezone: 'America/Mexico_City',
}

describe('calendar-sync — estados', () => {
  it('pendiente → evento tentative', () => {
    expect(statusToGoogleEventStatus('pendiente')).toBe('tentative')
  })
  it('confirmada/completada → evento confirmed', () => {
    expect(statusToGoogleEventStatus('confirmada')).toBe('confirmed')
    expect(statusToGoogleEventStatus('completada')).toBe('confirmed')
  })
  it('cancelada/no_asistio → se borra el evento', () => {
    expect(shouldDeleteEvent('cancelada')).toBe(true)
    expect(shouldDeleteEvent('no_asistio')).toBe(true)
    expect(shouldDeleteEvent('confirmada')).toBe(false)
    expect(shouldDeleteEvent('pendiente')).toBe(false)
  })
})

describe('calendar-sync — plan', () => {
  it('cancelada produce plan delete', () => {
    expect(planAppointmentSync(appt({ status: 'cancelada' }), ctx)).toEqual({
      op: 'delete',
    })
  })
  it('no_asistio produce plan delete', () => {
    expect(planAppointmentSync(appt({ status: 'no_asistio' }), ctx)).toEqual({
      op: 'delete',
    })
  })
  it('confirmada produce plan upsert con evento', () => {
    const plan = planAppointmentSync(appt(), ctx)
    expect(plan.op).toBe('upsert')
    if (plan.op !== 'upsert') return
    expect(plan.event.summary).toBe('Laura Medina · Valoración')
    expect(plan.event.status).toBe('confirmed')
  })
})

describe('calendar-sync — evento', () => {
  it('lleva la zona de la clínica y el instante correcto', () => {
    const ev = buildEventInput(appt(), ctx)
    expect(ev.start.timeZone).toBe('America/Mexico_City')
    expect(ev.start.dateTime).toBe('2026-07-10T16:00:00.000Z')
    expect(ev.end.dateTime).toBe('2026-07-10T17:00:00.000Z')
  })

  it('el título omite el procedimiento cuando no hay', () => {
    const ev = buildEventInput(appt(), { ...ctx, procedureName: null })
    expect(ev.summary).toBe('Laura Medina')
  })

  it('la descripción refleja el anticipo pendiente', () => {
    const ev = buildEventInput(
      appt({ deposit_status: 'pendiente', deposit_amount: 350 }),
      ctx,
    )
    expect(ev.description).toContain('Anticipo pendiente')
    expect(ev.description).toContain('350')
  })
})

describe('calendar-sync — color', () => {
  it('sin color devuelve undefined (usa el default del calendario)', () => {
    expect(nearestGoogleColorId(null)).toBeUndefined()
  })
  it('un rojo mapea al colorId Tomate (11)', () => {
    expect(nearestGoogleColorId('#d50000')).toBe('11')
  })
  it('un verde mapea a un colorId verde (Basil 10 o Sage 2)', () => {
    expect(['2', '10']).toContain(nearestGoogleColorId('#0b8043'))
  })
  it('tolera hex sin # y mayúsculas', () => {
    expect(nearestGoogleColorId('D50000')).toBe('11')
  })
})
