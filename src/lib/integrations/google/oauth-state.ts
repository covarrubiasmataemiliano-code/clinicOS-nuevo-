// ============================================================
// clinicOS — `state` firmado para el OAuth de Google (anti-CSRF).
//
// El `state` viaja a Google y vuelve en el callback. Para que un tercero
// no pueda forjar un callback que conecte SU Google a la cuenta de la
// víctima, el state es un token firmado (HMAC-SHA256) que ata la cuenta
// y el usuario que iniciaron el flujo, con caducidad corta. El callback
// verifica firma + frescura + que coincida con la sesión actual.
//
// Sin estado en servidor (nada que guardar/limpiar): el token es
// autocontenido. La llave es ENCRYPTION_KEY (ya existe), con separación
// de dominio por una etiqueta fija para no reusar bytes con el cifrado
// de tokens.
// ============================================================

import crypto from 'crypto'

const STATE_LABEL = 'clinicos.google.oauth.state.v1'
/** Ventana de validez del state: el consentimiento no debería tardar más. */
export const STATE_MAX_AGE_MS = 10 * 60 * 1000 // 10 minutos

interface StatePayload {
  /** account_id que inició el flujo. */
  a: string
  /** user_id que inició el flujo. */
  u: string
  /** epoch ms de emisión. */
  t: number
  /** nonce aleatorio (evita states idénticos y da entropía). */
  n: string
}

function hmacKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY no está configurada')
  // Deriva una subllave por dominio para no reusar bytes con encrypt().
  return crypto.createHmac('sha256', Buffer.from(key, 'hex'))
    .update(STATE_LABEL)
    .digest()
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function sign(payloadB64: string): string {
  return b64url(crypto.createHmac('sha256', hmacKey()).update(payloadB64).digest())
}

export interface SignStateArgs {
  accountId: string
  userId: string
  /** epoch ms; inyectable para tests. Default: ahora. */
  nowMs?: number
  /** nonce; inyectable para tests. Default: aleatorio. */
  nonce?: string
}

/** Emite un `state` firmado para arrancar el consentimiento. */
export function signOAuthState(args: SignStateArgs): string {
  const payload: StatePayload = {
    a: args.accountId,
    u: args.userId,
    t: args.nowMs ?? Date.now(),
    n: args.nonce ?? crypto.randomBytes(12).toString('hex'),
  }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${payloadB64}.${sign(payloadB64)}`
}

export interface VerifiedState {
  accountId: string
  userId: string
}

/**
 * Verifica un `state`: firma válida (comparación en tiempo constante) y
 * dentro de la ventana de frescura. Devuelve la cuenta/usuario que lo
 * emitieron, o null si es inválido/caduco. El callback debe además
 * exigir que coincidan con la sesión actual.
 */
export function verifyOAuthState(
  state: string,
  opts: { nowMs?: number; maxAgeMs?: number } = {},
): VerifiedState | null {
  if (typeof state !== 'string' || !state.includes('.')) return null
  const [payloadB64, sig] = state.split('.')
  if (!payloadB64 || !sig) return null

  const expected = sign(payloadB64)
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length) return null
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null

  let payload: StatePayload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (
    !payload ||
    typeof payload.a !== 'string' ||
    typeof payload.u !== 'string' ||
    typeof payload.t !== 'number'
  ) {
    return null
  }

  const now = opts.nowMs ?? Date.now()
  const maxAge = opts.maxAgeMs ?? STATE_MAX_AGE_MS
  if (now - payload.t > maxAge || payload.t - now > 60_000) {
    // Caduco, o emitido "en el futuro" (reloj manipulado) → rechazar.
    return null
  }

  return { accountId: payload.a, userId: payload.u }
}
