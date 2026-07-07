import { describe, it, expect } from 'vitest'
import { computeAvailableSlots, type ClinicHoursRow } from './availability'
import { wallPartsInTz } from './clinic-time'

const MX = 'America/Mexico_City'

// Miércoles 8 de julio de 2026, 9-14 (grilla de 30 min) en CDMX.
const WED_MORNING: ClinicHoursRow = {
  weekday: 3,
  opens_at: '09:00',
  closes_at: '14:00',
  slot_minutes: 30,
}

describe('computeAvailableSlots', () => {
  it('genera la grilla de un día vacío respetando la duración', () => {
    // from = miércoles 00:00 CDMX (06:00Z).
    const from = new Date('2026-07-08T06:00:00Z')
    const slots = computeAvailableSlots({
      timezone: MX,
      hours: [WED_MORNING],
      busy: [],
      durationMinutes: 60,
      from,
      days: 1,
      limit: 100,
    })
    // 09:00→14:00, huecos de 60 min en grilla de 30: últimos inicios 13:00.
    // 09:00, 09:30, …, 13:00 = 9 huecos.
    expect(slots).toHaveLength(9)
    const first = wallPartsInTz(slots[0].startsAt, MX)
    expect(first).toMatchObject({ hour: 9, minute: 0 })
    const last = wallPartsInTz(slots[slots.length - 1].startsAt, MX)
    expect(last).toMatchObject({ hour: 13, minute: 0 })
  })

  it('descarta huecos ocupados por una cita', () => {
    const from = new Date('2026-07-08T06:00:00Z')
    // Cita 11:00-12:00 CDMX (17:00-18:00Z).
    const busy = [
      {
        startsAt: new Date('2026-07-08T17:00:00Z'),
        endsAt: new Date('2026-07-08T18:00:00Z'),
      },
    ]
    const slots = computeAvailableSlots({
      timezone: MX,
      hours: [WED_MORNING],
      busy,
      durationMinutes: 60,
      from,
      days: 1,
      limit: 100,
    })
    const hours = slots.map((s) => wallPartsInTz(s.startsAt, MX).hour * 60 + wallPartsInTz(s.startsAt, MX).minute)
    // 10:00 (termina 11:00, no choca) queda; 10:30, 11:00, 11:30 chocan.
    expect(hours).toContain(10 * 60) // 10:00 ok
    expect(hours).not.toContain(10 * 60 + 30) // 10:30 choca
    expect(hours).not.toContain(11 * 60) // 11:00 choca
    expect(hours).not.toContain(11 * 60 + 30) // 11:30 choca
    expect(hours).toContain(12 * 60) // 12:00 vuelve a estar libre
  })

  it('no ofrece huecos en el pasado', () => {
    // from = 11:15 CDMX → el primer hueco válido es 11:30.
    const from = new Date('2026-07-08T17:15:00Z')
    const slots = computeAvailableSlots({
      timezone: MX,
      hours: [WED_MORNING],
      busy: [],
      durationMinutes: 30,
      from,
      days: 1,
      limit: 100,
    })
    const firstLocal = wallPartsInTz(slots[0].startsAt, MX)
    expect(firstLocal.hour * 60 + firstLocal.minute).toBe(11 * 60 + 30)
  })

  it('salta días sin horario configurado', () => {
    // Solo hay horario el miércoles; explorando jueves-viernes no hay nada.
    const from = new Date('2026-07-09T06:00:00Z') // jueves
    const slots = computeAvailableSlots({
      timezone: MX,
      hours: [WED_MORNING],
      busy: [],
      durationMinutes: 30,
      from,
      days: 2,
      limit: 100,
    })
    expect(slots).toHaveLength(0)
  })

  it('recorta al límite pedido, ordenado por cercanía', () => {
    const from = new Date('2026-07-08T06:00:00Z')
    const slots = computeAvailableSlots({
      timezone: MX,
      hours: [WED_MORNING],
      busy: [],
      durationMinutes: 30,
      from,
      days: 1,
      limit: 2,
    })
    expect(slots).toHaveLength(2)
    expect(slots[0].startsAt.getTime()).toBeLessThan(slots[1].startsAt.getTime())
  })

  it('respeta múltiples ventanas del mismo día (mañana y tarde)', () => {
    const from = new Date('2026-07-08T06:00:00Z')
    const afternoon: ClinicHoursRow = {
      weekday: 3,
      opens_at: '15:30',
      closes_at: '19:00',
      slot_minutes: 30,
    }
    const slots = computeAvailableSlots({
      timezone: MX,
      hours: [WED_MORNING, afternoon],
      busy: [],
      durationMinutes: 30,
      from,
      days: 1,
      limit: 100,
    })
    const localHours = slots.map((s) => wallPartsInTz(s.startsAt, MX).hour)
    expect(localHours).toContain(9) // mañana
    expect(localHours).toContain(18) // tarde
    // Nada entre 14:00 y 15:30 (hueco de comida).
    expect(slots.some((s) => wallPartsInTz(s.startsAt, MX).hour === 14)).toBe(false)
    expect(slots.some((s) => wallPartsInTz(s.startsAt, MX).hour === 15 && wallPartsInTz(s.startsAt, MX).minute === 0)).toBe(false)
  })
})
