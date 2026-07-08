import { describe, it, expect } from 'vitest'

import {
  signOAuthState,
  verifyOAuthState,
  STATE_MAX_AGE_MS,
} from './oauth-state'

const T0 = 1_700_000_000_000

describe('oauth-state — firma y verificación', () => {
  it('un state firmado se verifica y devuelve cuenta+usuario', () => {
    const state = signOAuthState({
      accountId: 'acc-1',
      userId: 'user-1',
      nowMs: T0,
      nonce: 'fixednonce',
    })
    const v = verifyOAuthState(state, { nowMs: T0 })
    expect(v).toEqual({ accountId: 'acc-1', userId: 'user-1' })
  })

  it('rechaza un state con la firma alterada (anti-CSRF)', () => {
    const state = signOAuthState({
      accountId: 'acc-1',
      userId: 'user-1',
      nowMs: T0,
      nonce: 'n',
    })
    // Alterar el último carácter de la firma.
    const tampered = state.slice(0, -1) + (state.endsWith('A') ? 'B' : 'A')
    expect(verifyOAuthState(tampered, { nowMs: T0 })).toBeNull()
  })

  it('rechaza un payload manipulado (cambia la cuenta sin re-firmar)', () => {
    const state = signOAuthState({
      accountId: 'acc-1',
      userId: 'user-1',
      nowMs: T0,
      nonce: 'n',
    })
    const [, sig] = state.split('.')
    const forgedPayload = Buffer.from(
      JSON.stringify({ a: 'acc-EVIL', u: 'user-1', t: T0, n: 'n' }),
      'utf8',
    ).toString('base64url')
    const forged = `${forgedPayload}.${sig}`
    expect(verifyOAuthState(forged, { nowMs: T0 })).toBeNull()
  })

  it('rechaza un state caducado', () => {
    const state = signOAuthState({
      accountId: 'acc-1',
      userId: 'user-1',
      nowMs: T0,
      nonce: 'n',
    })
    const later = T0 + STATE_MAX_AGE_MS + 1
    expect(verifyOAuthState(state, { nowMs: later })).toBeNull()
  })

  it('rechaza un state emitido "en el futuro" (reloj manipulado)', () => {
    const state = signOAuthState({
      accountId: 'acc-1',
      userId: 'user-1',
      nowMs: T0 + 5 * 60_000,
      nonce: 'n',
    })
    // Verificar "ahora" muy anterior al t del token.
    expect(verifyOAuthState(state, { nowMs: T0 })).toBeNull()
  })

  it('rechaza basura sin punto separador', () => {
    expect(verifyOAuthState('no-dot-here', { nowMs: T0 })).toBeNull()
    expect(verifyOAuthState('', { nowMs: T0 })).toBeNull()
  })
})
