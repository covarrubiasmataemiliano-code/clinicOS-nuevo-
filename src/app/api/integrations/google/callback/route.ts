import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { settingsResultUrl } from '@/lib/integrations/google/config'
import { verifyOAuthState } from '@/lib/integrations/google/oauth-state'
import {
  exchangeCodeForTokens,
  fetchUserEmail,
} from '@/lib/integrations/google/oauth'
import { ensureClinicCalendar } from '@/lib/integrations/google/calendar'
import { ensureRootFolder } from '@/lib/integrations/google/drive'
import { storeGoogleConnection } from '@/lib/integrations/google/client'

/**
 * GET /api/integrations/google/callback
 *
 * Vuelta del consentimiento. Verifica el `state` (anti-CSRF) contra la
 * sesión actual, intercambia el `code` por tokens, aprovisiona el
 * calendario "Clínica" y la carpeta raíz de Drive, y guarda la conexión
 * (tokens cifrados). Redirige a Settings → Integraciones con el
 * resultado. Cualquier fallo redirige con `?google=error&code=...`, sin
 * filtrar detalles internos.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const oauthError = url.searchParams.get('error')

    if (oauthError) {
      // El usuario canceló o Google rechazó el consentimiento.
      return NextResponse.redirect(settingsResultUrl('error', 'consent_denied'))
    }
    if (!code || !state) {
      return NextResponse.redirect(settingsResultUrl('error', 'missing_params'))
    }

    // La sesión actual debe ser la misma cuenta+usuario que inició el
    // flujo, y con rol admin (getCurrentAccount + verificación abajo).
    const { supabase, accountId, userId, role } = await getCurrentAccount()
    if (role !== 'owner' && role !== 'admin') {
      return NextResponse.redirect(settingsResultUrl('error', 'forbidden'))
    }

    const verified = verifyOAuthState(state)
    if (
      !verified ||
      verified.accountId !== accountId ||
      verified.userId !== userId
    ) {
      return NextResponse.redirect(settingsResultUrl('error', 'bad_state'))
    }

    // Intercambio + aprovisionamiento con el token recién obtenido.
    const tokens = await exchangeCodeForTokens(code)
    const email = await fetchUserEmail(tokens.accessToken)

    let calendarId: string
    let driveRootFolderId: string
    try {
      calendarId = await ensureClinicCalendar(tokens.accessToken, null)
      driveRootFolderId = await ensureRootFolder(tokens.accessToken, null)
    } catch (err) {
      console.error('[google/callback] aprovisionamiento falló:', err)
      return NextResponse.redirect(settingsResultUrl('error', 'provisioning'))
    }

    const { error } = await storeGoogleConnection({
      db: supabase,
      accountId,
      userId,
      tokens,
      email,
      calendarId,
      driveRootFolderId,
    })
    if (error) {
      // Caso típico: sin refresh_token (la app ya tenía acceso). Se pide
      // reconectar tras revocar en la cuenta de Google.
      console.error('[google/callback] guardado falló:', error)
      const code = error.includes('refresh_token') ? 'no_refresh_token' : 'store_failed'
      return NextResponse.redirect(settingsResultUrl('error', code))
    }

    return NextResponse.redirect(settingsResultUrl('ok', 'connected'))
  } catch (err) {
    // Errores no clasificados: log y una vuelta genérica de error, salvo
    // que sea un problema de auth (lo maneja toErrorResponse con 401/403).
    console.error('[google/callback] error:', err)
    return toErrorResponse(err)
  }
}
