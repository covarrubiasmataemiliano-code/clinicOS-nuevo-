// ============================================================
// clinicOS — llamadas OAuth2 a Google (REST, por fetch).
//
// Funciones puras (sin BD): construir la URL de consentimiento,
// intercambiar el `code`, refrescar el access_token, revocar y leer el
// correo de la cuenta. La persistencia cifrada vive en `client.ts`.
// ============================================================

import {
  GOOGLE_AUTH_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  googleOAuthEnv,
} from './config'

/** Timeout corto para las llamadas a Google (igual criterio que webhooks). */
const GOOGLE_TIMEOUT_MS = 10_000

export interface GoogleTokens {
  accessToken: string
  /** Solo llega en el primer intercambio (access_type=offline + prompt=consent). */
  refreshToken: string | null
  /** epoch ms de caducidad del access_token. */
  expiresAtMs: number
  scope: string
  tokenType: string
}

/**
 * URL de consentimiento. `access_type=offline` + `prompt=consent` para
 * garantizar refresh_token; `include_granted_scopes` para sumar sin
 * perder permisos previos.
 */
export function buildAuthUrl(state: string): string {
  const { clientId, redirectUri } = googleOAuthEnv()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

function expiresAtMsFrom(expiresIn: unknown, nowMs: number): number {
  const secs = typeof expiresIn === 'number' ? expiresIn : 3600
  return nowMs + secs * 1000
}

/** Intercambia el `code` del callback por tokens. */
export async function exchangeCodeForTokens(
  code: string,
  nowMs = Date.now(),
): Promise<GoogleTokens> {
  const { clientId, clientSecret, redirectUri } = googleOAuthEnv()
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      `Google token exchange falló (${res.status}): ${data.error_description || data.error || 'desconocido'}`,
    )
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAtMs: expiresAtMsFrom(data.expires_in, nowMs),
    scope: data.scope ?? '',
    tokenType: data.token_type ?? 'Bearer',
  }
}

/** Refresca el access_token con el refresh_token guardado. */
export async function refreshAccessToken(
  refreshToken: string,
  nowMs = Date.now(),
): Promise<GoogleTokens> {
  const { clientId, clientSecret } = googleOAuthEnv()
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      `Google token refresh falló (${res.status}): ${data.error_description || data.error || 'desconocido'}`,
    )
  }
  return {
    accessToken: data.access_token,
    // Un refresh normalmente NO trae refresh_token nuevo → conservamos el viejo.
    refreshToken: data.refresh_token ?? null,
    expiresAtMs: expiresAtMsFrom(data.expires_in, nowMs),
    scope: data.scope ?? '',
    tokenType: data.token_type ?? 'Bearer',
  }
}

/** Revoca un token (access o refresh) al desconectar. Best-effort. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    })
  } catch (err) {
    console.error('[google/oauth] revoke falló (se ignora):', err)
  }
}

/** Correo de la cuenta conectada, para mostrarlo en settings. */
export async function fetchUserEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => ({}))
    return typeof data.email === 'string' ? data.email : null
  } catch {
    return null
  }
}
