// ============================================================
// clinicOS — gestión de la conexión de Google en BD (tokens cifrados).
//
// Une el OAuth puro (`oauth.ts`) con la fila `google_connections`:
// carga la conexión de una cuenta, refresca el access_token si está por
// vencer (reescribiéndolo cifrado), y devuelve un token fresco listo
// para llamar Calendar/Drive. Los tokens SIEMPRE viajan cifrados en BD
// (AES-256-GCM, misma rutina que whatsapp_config).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import {
  refreshAccessToken,
  type GoogleTokens,
} from './oauth'

/** Margen para refrescar antes de que venza (evita usar un token al filo). */
export const REFRESH_SKEW_MS = 60_000 // 1 minuto

export interface GoogleConnectionRow {
  id: string
  account_id: string
  google_email: string | null
  access_token: string // cifrado
  refresh_token: string // cifrado
  token_expires_at: string | null
  scopes: string[]
  calendar_id: string | null
  drive_root_folder_id: string | null
  status: 'connected' | 'disconnected'
}

const CONNECTION_COLUMNS =
  'id, account_id, google_email, access_token, refresh_token, token_expires_at, scopes, calendar_id, drive_root_folder_id, status'

/** ¿Hay que refrescar el access_token ya? (puro, testeable). */
export function needsRefresh(
  tokenExpiresAt: string | null,
  nowMs: number,
  skewMs = REFRESH_SKEW_MS,
): boolean {
  if (!tokenExpiresAt) return true
  const expMs = new Date(tokenExpiresAt).getTime()
  if (Number.isNaN(expMs)) return true
  return nowMs + skewMs >= expMs
}

/** Carga la fila de conexión (sin descifrar). null si no hay o está desconectada. */
export async function getGoogleConnection(
  db: SupabaseClient,
  accountId: string,
): Promise<GoogleConnectionRow | null> {
  const { data, error } = await db
    .from('google_connections')
    .select(CONNECTION_COLUMNS)
    .eq('account_id', accountId)
    .eq('status', 'connected')
    .maybeSingle()
  if (error) {
    console.error('[google/client] lectura de conexión falló:', error)
    return null
  }
  return (data as GoogleConnectionRow | null) ?? null
}

export interface FreshConnection {
  accessToken: string
  connection: GoogleConnectionRow
}

/**
 * Devuelve un access_token fresco para la cuenta (refrescando y
 * reescribiendo cifrado si hace falta), junto con la fila de conexión.
 * null si la cuenta no tiene Google conectado.
 */
export async function getFreshAccessToken(
  db: SupabaseClient,
  accountId: string,
  nowMs = Date.now(),
): Promise<FreshConnection | null> {
  const connection = await getGoogleConnection(db, accountId)
  if (!connection) return null

  if (!needsRefresh(connection.token_expires_at, nowMs)) {
    return { accessToken: decrypt(connection.access_token), connection }
  }

  // Refrescar con el refresh_token guardado y reescribir el access cifrado.
  const refreshToken = decrypt(connection.refresh_token)
  const refreshed = await refreshAccessToken(refreshToken, nowMs)
  const patch: Record<string, unknown> = {
    access_token: encrypt(refreshed.accessToken),
    token_expires_at: new Date(refreshed.expiresAtMs).toISOString(),
  }
  // Google rara vez rota el refresh_token; si lo hace, guardamos el nuevo.
  if (refreshed.refreshToken) {
    patch.refresh_token = encrypt(refreshed.refreshToken)
  }
  const { error } = await db
    .from('google_connections')
    .update(patch)
    .eq('id', connection.id)
  if (error) {
    console.error('[google/client] no se pudo guardar el token refrescado:', error)
  }

  return {
    accessToken: refreshed.accessToken,
    connection: {
      ...connection,
      access_token: patch.access_token as string,
      token_expires_at: patch.token_expires_at as string,
      refresh_token: (patch.refresh_token as string) ?? connection.refresh_token,
    },
  }
}

export interface StoreConnectionArgs {
  db: SupabaseClient
  accountId: string
  userId: string
  tokens: GoogleTokens
  email: string | null
  calendarId: string | null
  driveRootFolderId: string | null
}

/**
 * Guarda (o reemplaza) la conexión de la cuenta tras un consentimiento
 * exitoso. Cifra ambos tokens. Requiere refresh_token (el flujo pide
 * `access_type=offline` + `prompt=consent`).
 */
export async function storeGoogleConnection(
  args: StoreConnectionArgs,
): Promise<{ error: string | null }> {
  const { db, accountId, userId, tokens, email, calendarId, driveRootFolderId } =
    args
  if (!tokens.refreshToken) {
    return {
      error:
        'Google no devolvió refresh_token. Quita el acceso de la app en tu cuenta de Google y vuelve a conectar.',
    }
  }
  const row = {
    account_id: accountId,
    connected_by_user_id: userId,
    google_email: email,
    access_token: encrypt(tokens.accessToken),
    refresh_token: encrypt(tokens.refreshToken),
    token_expires_at: new Date(tokens.expiresAtMs).toISOString(),
    scopes: tokens.scope ? tokens.scope.split(' ') : [],
    calendar_id: calendarId,
    drive_root_folder_id: driveRootFolderId,
    status: 'connected' as const,
  }
  const { error } = await db
    .from('google_connections')
    .upsert(row, { onConflict: 'account_id' })
  return { error: error ? error.message : null }
}
