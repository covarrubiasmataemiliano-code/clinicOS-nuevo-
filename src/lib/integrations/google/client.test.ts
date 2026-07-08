import { describe, it, expect, vi, beforeEach } from 'vitest'

import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { needsRefresh, getFreshAccessToken } from './client'

// Mock del OAuth puro: controlamos el refresh sin tocar la red.
vi.mock('./oauth', () => ({
  refreshAccessToken: vi.fn(),
}))
import { refreshAccessToken } from './oauth'

const T0 = 1_700_000_000_000

/**
 * Supabase falso mínimo para google_connections: `select…maybeSingle`
 * devuelve la fila; `update…eq` captura el patch. El builder es awaitable
 * (para el update) y expone maybeSingle (para el select).
 */
function makeDb(row: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = []
  const db = {
    from() {
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          updates.push(payload)
          return builder
        },
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: row, error: null }),
        then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
      }
      return builder
    },
  }
  return { db: db as never, updates }
}

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    account_id: 'acc-1',
    google_email: 'clinic@example.com',
    access_token: encrypt('access-old'),
    refresh_token: encrypt('refresh-1'),
    token_expires_at: new Date(T0 + 60 * 60_000).toISOString(),
    scopes: ['calendar'],
    calendar_id: 'cal-1',
    drive_root_folder_id: 'root-1',
    status: 'connected',
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(refreshAccessToken).mockReset()
})

describe('needsRefresh', () => {
  it('token sin caducidad → refrescar', () => {
    expect(needsRefresh(null, T0)).toBe(true)
  })
  it('token ya vencido → refrescar', () => {
    expect(needsRefresh(new Date(T0 - 1000).toISOString(), T0)).toBe(true)
  })
  it('token que vence dentro del margen → refrescar', () => {
    expect(needsRefresh(new Date(T0 + 30_000).toISOString(), T0)).toBe(true)
  })
  it('token con margen de sobra → NO refrescar', () => {
    expect(needsRefresh(new Date(T0 + 10 * 60_000).toISOString(), T0)).toBe(false)
  })
})

describe('getFreshAccessToken', () => {
  it('sin conexión devuelve null', async () => {
    const { db } = makeDb(null)
    expect(await getFreshAccessToken(db, 'acc-1', T0)).toBeNull()
    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it('token vigente: devuelve el access descifrado sin refrescar', async () => {
    const { db, updates } = makeDb(connectionRow())
    const fresh = await getFreshAccessToken(db, 'acc-1', T0)
    expect(fresh?.accessToken).toBe('access-old')
    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('token por vencer: refresca, reescribe cifrado y devuelve el nuevo', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-new',
      refreshToken: null,
      expiresAtMs: T0 + 3600_000,
      scope: 'calendar',
      tokenType: 'Bearer',
    })
    const { db, updates } = makeDb(
      connectionRow({ token_expires_at: new Date(T0 - 1000).toISOString() }),
    )
    const fresh = await getFreshAccessToken(db, 'acc-1', T0)

    expect(refreshAccessToken).toHaveBeenCalledWith('refresh-1', T0)
    expect(fresh?.accessToken).toBe('access-new')
    // Guardó el nuevo access token CIFRADO (no en claro).
    expect(updates).toHaveLength(1)
    const patch = updates[0]
    expect(patch.access_token).not.toBe('access-new')
    expect(decrypt(patch.access_token as string)).toBe('access-new')
    // Sin refresh nuevo, no se toca el refresh_token guardado.
    expect(patch.refresh_token).toBeUndefined()
  })

  it('si el refresh rota el refresh_token, guarda el nuevo cifrado', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-new',
      refreshToken: 'refresh-2',
      expiresAtMs: T0 + 3600_000,
      scope: 'calendar',
      tokenType: 'Bearer',
    })
    const { db, updates } = makeDb(
      connectionRow({ token_expires_at: new Date(T0 - 1000).toISOString() }),
    )
    await getFreshAccessToken(db, 'acc-1', T0)
    expect(decrypt(updates[0].refresh_token as string)).toBe('refresh-2')
  })
})
