import { describe, it, expect } from 'vitest'
import {
  wallPartsInTz,
  instantFromWallTime,
  instantFromLocalDateTime,
  parseClockToMinutes,
} from './clinic-time'

const MX = 'America/Mexico_City' // hoy offset fijo -06:00 (sin DST)

describe('wallPartsInTz', () => {
  it('descompone un instante UTC en hora de pared de la clínica', () => {
    // 2026-07-08T17:00:00Z = 11:00 en Ciudad de México (-06:00).
    const p = wallPartsInTz(new Date('2026-07-08T17:00:00Z'), MX)
    expect(p).toMatchObject({
      year: 2026,
      month: 7,
      day: 8,
      hour: 11,
      minute: 0,
    })
    expect(p.weekday).toBe(3) // miércoles
  })

  it('cruza el límite de día correctamente', () => {
    // 05:30Z = 23:30 del día anterior en CDMX.
    const p = wallPartsInTz(new Date('2026-07-08T05:30:00Z'), MX)
    expect(p).toMatchObject({ year: 2026, month: 7, day: 7, hour: 23, minute: 30 })
  })
})

describe('instantFromWallTime', () => {
  it('es la inversa de wallPartsInTz', () => {
    const instant = instantFromWallTime(MX, 2026, 7, 8, 11, 0)
    expect(instant.toISOString()).toBe('2026-07-08T17:00:00.000Z')
  })

  it('round-trip pared → instante → pared', () => {
    const start = instantFromLocalDateTime(
      MX,
      { year: 2026, month: 12, day: 24 },
      { hour: 9, minute: 30 },
    )
    const back = wallPartsInTz(start, MX)
    expect(back).toMatchObject({
      year: 2026,
      month: 12,
      day: 24,
      hour: 9,
      minute: 30,
    })
  })

  it('respeta una zona con offset distinto', () => {
    // Madrid en julio = +02:00 → 09:00 local = 07:00Z.
    const instant = instantFromWallTime('Europe/Madrid', 2026, 7, 8, 9, 0)
    expect(instant.toISOString()).toBe('2026-07-08T07:00:00.000Z')
  })
})

describe('parseClockToMinutes', () => {
  it('parsea HH:MM y HH:MM:SS', () => {
    expect(parseClockToMinutes('09:00')).toBe(540)
    expect(parseClockToMinutes('15:30:00')).toBe(930)
    expect(parseClockToMinutes('00:00')).toBe(0)
  })
})
