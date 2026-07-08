import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getGoogleConnection } from '@/lib/integrations/google/client'
import { revokeToken } from '@/lib/integrations/google/oauth'

/**
 * POST /api/integrations/google/disconnect  (admin+)
 *
 * Revoca el acceso en Google (best-effort) y borra la fila de conexión
 * — con ella se van los tokens cifrados. Las citas ya reflejadas en
 * Google quedan como están (no se borran); dejan de sincronizarse.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(
      `google-disconnect:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const connection = await getGoogleConnection(supabase, accountId)
    if (connection) {
      // Revocar en Google usando el refresh_token (revoca todo el grant).
      try {
        await revokeToken(decrypt(connection.refresh_token))
      } catch (err) {
        console.error('[google/disconnect] no se pudo descifrar/revocar:', err)
      }
      const { error } = await supabase
        .from('google_connections')
        .delete()
        .eq('id', connection.id)
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
